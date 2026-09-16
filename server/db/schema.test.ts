import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8')

describe('initial PostgreSQL migration', () => {
  it('uses exact decimal money with database constraints', () => {
    expect(migration).not.toMatch(/\b(real|double precision|money)\b/i)
    expect(migration.match(/numeric\(14,2\)/gi)?.length).toBeGreaterThanOrEqual(10)
    expect(migration).toContain('CHECK (agreed_price >= 0)')
    expect(migration).toContain('CHECK (paid_amount >= 0 AND paid_amount <= amount)')
  })

  it('enforces unit, role, idempotency, allocation, and audit invariants', () => {
    expect(migration).toContain("role IN ('admin', 'owner', 'coordinator')")
    expect(migration).toContain("password_hash text")
    expect(migration).toContain("business_unit IN ('SPL', '5to Elemento')")
    expect(migration.match(/idempotency_key varchar\(100\) NOT NULL UNIQUE/g)?.length).toBe(3)
    expect(migration).toContain("allocation_scope IN ('event', 'warehouse')")
    expect(migration).toContain('CREATE TABLE audit_log')
    expect(migration).toContain('CREATE TABLE sessions')
    expect(migration).toContain('token_hash char(64) NOT NULL UNIQUE')
    expect(migration).not.toContain('session_token text')
  })
})
