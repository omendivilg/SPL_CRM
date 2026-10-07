import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { newDb, DataType } from 'pg-mem'
import type { Pool, PoolClient } from 'pg'
import { describe, expect, it } from 'vitest'
import { importLocalSnapshot, parseLocalImportState, type LocalImportState } from './local-import.js'
import { PostgresEventRepository } from './repository.js'
import { PostgresWeeklyStore } from './postgres-weekly.js'
import { emptyWeekly, saveWeekly, payWeekly } from './weekly.js'

const principal = { userId: randomUUID(), role: 'owner' as const, unit: null }
const timestamp = '2026-10-01T12:00:00.000Z'

async function setup() {
  const db = newDb()
  // Emulate PostgreSQL's explicit date-only formatting; pg-mem has no built-in DATE to text cast.
  db.public.registerFunction({ name: 'to_char', args: [DataType.date, DataType.text], returns: DataType.text, implementation: (value: Date) => value.toISOString().slice(0, 10) })
  db.registerExtension('pgcrypto', schema => schema.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, implementation: randomUUID, impure: true }))
  db.public.registerFunction({ name: 'jsonb_typeof', args: [DataType.jsonb], returns: DataType.text, implementation: value => Array.isArray(value) ? 'array' : typeof value })
  // 002 repeats the workers/templates definitions already applied by 001; pg-mem cannot re-plan those no-ops.
  const directory = new URL('./db/migrations/', import.meta.url)
  for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql') && name !== '002_payroll_directory.sql').sort()) {
    db.public.none(await readFile(new URL(file, directory), 'utf8'))
  }
  const { Pool: MemoryPool } = db.adapters.createPg()
  return new MemoryPool() as unknown as Pool
}

function snapshot(): LocalImportState {
  const worker = { id: randomUUID(), name: 'Trabajador de prueba', active: true }
  const state: LocalImportState = {
    users: [{ id: principal.userId, email: 'test@example.test', displayName: 'Import test', passwordHash: null, role: 'coordinator', businessUnit: '5to Elemento', active: true }],
    events: [], expenses: [], payments: [], payroll: [], payrollSettlements: [], workers: [worker], payrollTemplates: [], weekly: emptyWeekly(),
  }
  for (let index = 0; index < 8; index++) {
    const event = { id: randomUUID(), businessUnit: 'SPL' as const, clientName: `Evento ${index}`, clientPhone: null, venue: 'Lugar de prueba', eventDate: '2026-10-01', operationalStatus: 'Completado' as const, operationalNotes: 'Notas originales', financialNotes: 'Notas financieras', agreedPrice: ['150000.00', '65000.00', '65000.00'][index] ?? '100.00', payrollBudget: '0.00', extraExpenseBudget: '0.00', version: 3, createdAt: timestamp, updatedAt: timestamp, ...(index >= 3 ? { deletedAt: timestamp } : {}) }
    state.events.push(event)
    const payment = { id: randomUUID(), eventId: event.id, amount: event.agreedPrice, kind: 'payment' as const, transactionDate: '2026-10-01', idempotencyKey: randomUUID(), createdAt: timestamp, version: 4, ...(index >= 3 && index < 6 ? { deletedAt: timestamp } : {}) }
    state.payments.push([event.id, [payment]])
  }
  // A removed refund on an active event must not reduce its completed balance.
  state.payments[0][1].push({ id: randomUUID(), eventId: state.events[0].id, amount: '500.00', kind: 'refund', transactionDate: '2026-10-01', idempotencyKey: randomUUID(), createdAt: timestamp, version: 2, deletedAt: timestamp })
  for (let index = 0; index < 4; index++) {
    const start = `2026-09-${String(1 + index * 7).padStart(2, '0')}`
    const end = `2026-09-${String(7 + index * 7).padStart(2, '0')}`
    const batch = saveWeekly(state.weekly!, { id: randomUUID(), version: 0, idempotencyKey: randomUUID(), businessUnit: 'SPL', periodStart: start, periodEnd: end, lines: [{ id: randomUUID(), employeeId: worker.id, baseCost: '100.00', additions: '0.00', deductions: '0.00', allocations: [{ scope: 'warehouse', amount: '100.00' }] }], expenses: [] }, [worker], new Map(), principal)
    payWeekly(state.weekly!, batch.id, { version: batch.version, paymentDate: end, idempotencyKey: randomUUID() }, principal)
  }
  return state
}

describe('local JSON import', () => {
  it('retains history but exposes only active events, completed payments and paid weekly payroll', async () => {
    const pool = await setup(), client = await pool.connect(), state = snapshot()
    try {
      const original = structuredClone(state)
      const result = await importLocalSnapshot(client, state, 'a'.repeat(64), 'snapshot.json')
      expect(result).toMatchObject({ alreadyImported: false, counts: { events: 8, activeEvents: 3, deletedEvents: 5, payments: 9, activePayments: 3, deletedPayments: 4, weeklyBatches: 4 } })
      expect(state).toEqual(original)
      const repository = new PostgresEventRepository(pool)
      const active = await repository.list(principal)
      expect(active.map(event => event.id).sort()).toEqual(state.events.slice(0, 3).map(event => event.id).sort())
      for (const event of active) {
        const payments = await repository.listPayments(event.id, principal)
        expect(payments).toHaveLength(1)
        expect(Number(payments![0].amount)).toBe(Number(event.agreedPrice))
        expect(payments![0].version).toBe(4)
        expect(event).toMatchObject({ operationalNotes: 'Notas originales', financialNotes: 'Notas financieras', version: 3, createdAt: timestamp, updatedAt: timestamp })
        expect(event.eventDate).toBe('2026-10-01')
      }
      const history = await pool.query('SELECT id, deleted_at FROM events')
      expect(history.rows).toHaveLength(8)
      expect(history.rows.filter(event => event.deleted_at)).toHaveLength(5)
      const payments = await pool.query('SELECT id, deleted_at FROM customer_payments')
      expect(payments.rows).toHaveLength(9)
      expect(payments.rows.filter(payment => payment.deleted_at)).toHaveLength(4)
      expect(await new PostgresWeeklyStore(pool).readWeekly()).toEqual(state.weekly)
      expect(state.weekly!.batches.every(batch => batch.status === 'paid')).toBe(true)
    } finally { client.release(); await pool.end() }
  })

  it('keeps repeated snapshots idempotent and rejects a different import into an occupied destination', async () => {
    const pool = await setup(), client = await pool.connect(), state = snapshot()
    try {
      await importLocalSnapshot(client, state, 'b'.repeat(64), 'snapshot.json')
      expect(await importLocalSnapshot(client, state, 'b'.repeat(64), 'snapshot.json')).toEqual({ alreadyImported: true })
      await expect(importLocalSnapshot(client, state, 'c'.repeat(64), 'another.json')).rejects.toThrow('Destination contains business data')
      expect((await pool.query('SELECT * FROM data_imports')).rows).toHaveLength(1)
      expect((await pool.query('SELECT * FROM events')).rows).toHaveLength(8)
    } finally { client.release(); await pool.end() }
  })

  it('rolls back and does not write an import marker when a database insert fails', async () => {
    const statements: string[] = []
    const client = { async query(text: string) {
      statements.push(text)
      if (text.startsWith('SELECT 1')) return { rowCount: 0, rows: [] }
      if (text.startsWith('SELECT (SELECT')) return { rowCount: 1, rows: [{ count: 0 }] }
      if (text.startsWith('INSERT INTO events')) throw new Error('invalid event')
      return { rowCount: 0, rows: [] }
    } } as unknown as Pick<PoolClient, 'query'>
    await expect(importLocalSnapshot(client, snapshot(), 'd'.repeat(64), 'bad.json')).rejects.toThrow('invalid event')
    expect(statements[0]).toBe('BEGIN')
    expect(statements.at(-1)).toBe('ROLLBACK')
    expect(statements.some(text => text === 'COMMIT' || text.startsWith('INSERT INTO data_imports'))).toBe(false)
  })

  it('rejects an invalid snapshot before importing', () => {
    expect(() => parseLocalImportState(null)).toThrow('snapshot object')
    expect(() => parseLocalImportState({ users: [] })).toThrow('events')
    expect(parseLocalImportState(snapshot()).events).toHaveLength(8)
  })
})


