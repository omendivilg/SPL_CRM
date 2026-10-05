import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PersistentDevelopmentStore } from './persistent-store.js'
import { buildApp } from './app.js'
import { saveWeekly } from './weekly.js'
import { receiveDirectIncome, saveDirectIncome } from './direct-income.js'
import { randomUUID } from 'node:crypto'

describe('persistent desktop store', () => {
  it('preserves a worker and session across application restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spl-store-'))
    const path = join(directory, 'data.json')
    const first = await PersistentDevelopmentStore.open(path)
    const user = await first.findOrCreateGoogleUser('omendivilg@gmail.com', 'Oscar', 'admin', null)
    await first.createSession(user.id, 'hashed-token', new Date('2030-01-01'))
    await first.createWorker({ name: 'Andrea López' })
    const second = await PersistentDevelopmentStore.open(path)
    expect((await second.listWorkers())[0]?.name).toBe('Andrea López')
    expect(await second.findPrincipal('hashed-token', new Date('2029-01-01'))).toMatchObject({ email: 'omendivilg@gmail.com' })
    expect(await readFile(path, 'utf8')).not.toContain('credential')
  })

  it('rejects malformed and oversized local data instead of loading attack payloads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spl-store-'))
    const malformed = join(directory, 'malformed.json')
    await writeFile(malformed, JSON.stringify({ __proto__: { admin: true }, users: '<script>alert(1)</script>' }))
    await expect(PersistentDevelopmentStore.open(malformed)).rejects.toThrow('estructura válida')
    const oversized = join(directory, 'oversized.json')
    await writeFile(oversized, 'x'.repeat(10 * 1024 * 1024 + 1))
    await expect(PersistentDevelopmentStore.open(oversized)).rejects.toThrow('límite permitido')
  })

  it('keeps a confirmed weekly payroll after reopening the desktop store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spl-weekly-store-'))
    const path = join(directory, 'data.json')
    const first = await PersistentDevelopmentStore.open(path)
    const worker = await first.createWorker({ name: 'Andrea López' })
    await first.transactWeekly(state => saveWeekly(state, {
      id: '11111111-1111-4111-8111-111111111111', version: 0, idempotencyKey: '22222222-2222-4222-8222-222222222222',
      businessUnit: 'SPL', periodStart: '2026-09-14', periodEnd: '2026-09-20', expenses: [],
      lines: [{ id: '33333333-3333-4333-8333-333333333333', employeeId: worker.id, baseCost: '1000.00', additions: '0.00', deductions: '0.00', allocations: [{ scope: 'warehouse', amount: '1000.00' }] }],
    }, [worker], new Map(), { userId: 'owner', role: 'owner', unit: null }))
    const second = await PersistentDevelopmentStore.open(path)
    expect((await second.readWeekly()).batches[0]).toMatchObject({ status: 'unpaid', periodStart: '2026-09-14' })
  })

  it('keeps income notes and their original audit after reopening alongside legacy v3 incomes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spl-income-notes-'))
    const path = join(directory, 'data.json')
    const first = await PersistentDevelopmentStore.open(path)
    const principal = { userId: 'owner', role: 'owner' as const, unit: null }
    const id = randomUUID(), legacyId = randomUUID()
    const input = { name: 'Renta de equipo', amount: '125.50', expectedDate: '2026-09-30', businessUnit: 'SPL' as const, notes: '  Comprobante recibido\nPago en oficina  ' }
    await first.transactWeekly(state => {
      state.directIncomes.push({ ...input, id: legacyId, notes: undefined, receivedDate: null, version: 1, createdBy: 'owner', createdAt: '2026-09-01T00:00:00Z' })
      return saveDirectIncome(state, id, input, principal)
    })
    await first.transactWeekly(state => receiveDirectIncome(state, id, { receivedDate: '2026-10-02', version: 1 }, principal))
    const reopened = await PersistentDevelopmentStore.open(path)
    const state = await reopened.readWeekly()
    expect(state.schemaVersion).toBe(3)
    expect(state.directIncomes.find(item => item.id === id)).toMatchObject({ notes: 'Comprobante recibido\nPago en oficina', receivedDate: '2026-10-02', version: 2 })
    expect(state.directIncomes.find(item => item.id === legacyId)).not.toHaveProperty('notes')
    expect(state.directIncomeAudit.map(item => item.after.notes)).toEqual(['Comprobante recibido\nPago en oficina', 'Comprobante recibido\nPago en oficina'])
    expect(state.directIncomeAudit[0].after.receivedDate).toBeNull()
    await reopened.transactWeekly(next => saveDirectIncome(next, id, input, principal))
    await reopened.transactWeekly(next => saveDirectIncome(next, legacyId, { ...input, notes: null }, principal))
    expect((await reopened.readWeekly()).directIncomes).toHaveLength(2)
  })
})

it('backs up legacy desktop data before migration and does not duplicate it on restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spl-legacy-backup-')), path = join(directory, 'data.json')
  const legacy = { users: [], sessions: [], events: [], expenses: [], payments: [], payroll: [], payrollSettlements: [], workers: [], payrollTemplates: [] }
  const original = JSON.stringify(legacy)
  await writeFile(path, original)
  const store = await PersistentDevelopmentStore.open(path)
  expect(await readFile(`${path}.before-payroll-v3.bak`, 'utf8')).toBe(original)
  const app = buildApp(store, async () => ({userId:'owner',role:'owner',unit:null}), undefined, undefined, store, store)
  await app.ready(); await app.close()
  const reopened = await PersistentDevelopmentStore.open(path)
  expect((await reopened.readWeekly()).migrated).toBe(true)
  expect(await readFile(`${path}.before-payroll-v3.bak`, 'utf8')).toBe(original)
})
