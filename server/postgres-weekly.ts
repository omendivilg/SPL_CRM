import type { Pool } from 'pg'
import { emptyWeekly, upgradeWeekly, type WeeklyState, type WeeklyStore } from './weekly.js'

export class PostgresWeeklyStore implements WeeklyStore {
  constructor(private readonly pool: Pool) {}

  async readWeekly() {
    const result = await this.pool.query<{ state: WeeklyState }>('SELECT state FROM weekly_payroll_state WHERE id = true')
    return upgradeWeekly(result.rows[0]?.state ?? emptyWeekly())
  }

  async transactWeekly<T>(operation: (state: WeeklyState) => T | Promise<T>) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("INSERT INTO weekly_payroll_state (id, state) VALUES (true, '{}'::jsonb) ON CONFLICT (id) DO NOTHING")
      const result = await client.query<{ state: WeeklyState }>('SELECT state FROM weekly_payroll_state WHERE id = true FOR UPDATE')
      const state = upgradeWeekly(result.rows[0]?.state ?? emptyWeekly())
      if ((result.rows[0]?.state as {schemaVersion?: number})?.schemaVersion !== 2) {
        await client.query("INSERT INTO weekly_payroll_backups (name, state) VALUES ('before-payroll-v2', $1::jsonb) ON CONFLICT (name) DO NOTHING", [JSON.stringify(result.rows[0]?.state ?? {})])
      }
      const output = await operation(state)
      await client.query('UPDATE weekly_payroll_state SET state = $1::jsonb, updated_at = now() WHERE id = true', [JSON.stringify(state)])
      await client.query('COMMIT')
      return output
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  }
}
