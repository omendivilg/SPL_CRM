import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { DevelopmentStore } from './dev.js'
import { upgradeWeekly } from './weekly.js'

function setup() {
  const store = new DevelopmentStore()
  const app = buildApp(store, async request => request.headers.authorization === 'coordinator'
    ? { userId: 'coord', role: 'coordinator', unit: '5to Elemento' }
    : { userId: 'owner', role: 'owner', unit: null }, undefined, undefined, store, store)
  return { app, store }
}

const payload = { name: 'Renta de equipo', amount: '125.50', expectedDate: '2026-09-30', businessUnit: '5to Elemento' }

describe('standalone direct income', () => {
  it('creates once, receives with a version, records the audit and excludes a deleted income', async () => {
    const { app, store } = setup()
    const id = randomUUID(), url = `/api/direct-income/${id}`
    const created = await app.inject({ method: 'PUT', url, payload })
    expect(created.statusCode).toBe(201)
    expect(created.json().data).toMatchObject({ ...payload, id, amount: '125.50', receivedDate: null, notes: null, version: 1, createdBy: 'owner' })
    expect((await app.inject({ method: 'PUT', url, payload })).json().data.id).toBe(id)
    expect((await app.inject({ method: 'GET', url: '/api/direct-income' })).json().data).toHaveLength(1)
    const received = await app.inject({ method: 'PATCH', url: `${url}/receive`, payload: { receivedDate: '2026-10-02', version: 1 } })
    expect(received.statusCode).toBe(200)
    expect(received.json().data).toMatchObject({ receivedDate: '2026-10-02', receivedBy: 'owner', version: 2 })
    expect((await app.inject({ method: 'PUT', url, payload })).json().data.version).toBe(2)
    expect((await app.inject({ method: 'PATCH', url: `${url}/receive`, payload: { receivedDate: '2026-10-02', version: 1 } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'DELETE', url, payload: { version: 1 } })).statusCode).toBe(409)
    const deleted = await app.inject({ method: 'DELETE', url, payload: { version: 2 } })
    expect(deleted.json().data).toMatchObject({ deletedBy: 'owner', version: 3 })
    expect((await app.inject({ method: 'GET', url: '/api/direct-income' })).json().data).toHaveLength(0)
    expect(store.weekly.directIncomeAudit.map(item => item.action)).toEqual(['created', 'received', 'deleted'])
    expect((await app.inject({ method: 'PUT', url, payload })).statusCode).toBe(409)
    await app.close()
  })

  it('creates an already paid income and rejects invalid input and unauthorized mutations', async () => {
    const { app, store } = setup()
    const url = `/api/direct-income/${randomUUID()}`
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE'] as const) {
      const target = method === 'GET' ? '/api/direct-income' : method === 'PATCH' ? `${url}/receive` : url
      expect((await app.inject({ method, url: target, headers: { authorization: 'coordinator' }, payload: method === 'GET' ? undefined : method === 'PUT' ? payload : { version: 1, receivedDate: '2026-09-30' } })).statusCode).toBe(403)
    }
    expect(store.weekly.directIncomes).toHaveLength(0)
    const invalid = [
      { ...payload, amount: '0.00' }, { ...payload, amount: '-1.00' }, { ...payload, businessUnit: 'Todos' },
      { ...payload, expectedDate: '2026-02-30' }, { ...payload, name: ' ' }, { ...payload, receivedDate: '2026-10-02' },
    ]
    for (const item of invalid) expect((await app.inject({ method: 'PUT', url, payload: item })).statusCode).toBe(400)
    const created = await app.inject({ method: 'PUT', url, payload: { ...payload, receivedDate: payload.expectedDate } })
    expect(created.json().data).toMatchObject({ receivedDate: payload.expectedDate, receivedBy: 'owner' })
    expect((await app.inject({ method: 'PATCH', url: `${url}/receive`, payload: { receivedDate: '2026-10-02', version: 1 } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'DELETE', url, payload: { version: 1 } })).statusCode).toBe(200)
    await app.close()
  })

  it('normalizes optional notes, compares retry notes against the creation and retains them in every audit', async () => {
    const { app, store } = setup()
    const url = `/api/direct-income/${randomUUID()}`
    const notes = 'Renta de iluminación\nPago de anticipo'
    const input = { ...payload, notes: `  ${notes}  ` }
    const created = await app.inject({ method: 'PUT', url, payload: input })
    expect(created.statusCode).toBe(201)
    expect(created.json().data.notes).toBe(notes)
    expect((await app.inject({ method: 'PUT', url, payload: { ...input, notes } })).statusCode).toBe(201)
    expect((await app.inject({ method: 'PUT', url, payload: { ...input, notes: 'Otra nota' } })).statusCode).toBe(409)
    const received = await app.inject({ method: 'PATCH', url: `${url}/receive`, payload: { receivedDate: '2026-10-02', version: 1 } })
    expect(received.json().data).toMatchObject({ notes, version: 2 })
    expect((await app.inject({ method: 'PUT', url, payload: input })).json().data.version).toBe(2)
    expect((await app.inject({ method: 'PUT', url, payload: { ...input, notes: null } })).statusCode).toBe(409)
    await app.inject({ method: 'DELETE', url, payload: { version: 2 } })
    expect(store.weekly.directIncomeAudit.map(item => item.after.notes)).toEqual([notes, notes, notes])
    expect(store.weekly.directIncomeAudit.slice(1).map(item => item.before?.notes)).toEqual([notes, notes])
    expect(store.weekly.directIncomeAudit[0].after).toMatchObject({ receivedDate: null, version: 1, notes })
    await app.close()
  })

  it('treats missing, null and blank notes as the same value and rejects invalid notes', async () => {
    const { app, store } = setup()
    const url = `/api/direct-income/${randomUUID()}`
    for (const notes of [undefined, null, '', ' \n ']) {
      const created = await app.inject({ method: 'PUT', url, payload: { ...payload, notes } })
      expect(created.statusCode).toBe(201)
      expect(created.json().data.notes).toBe(null)
    }
    expect(store.weekly.directIncomes).toHaveLength(1)
    for (const notes of ['x'.repeat(2001), 42, ['nota'], { text: 'nota' }]) {
      const invalid = await app.inject({ method: 'PUT', url: `/api/direct-income/${randomUUID()}`, payload: { ...payload, notes } })
      expect(invalid.statusCode).toBe(400)
      expect(invalid.json().issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'notes' })]))
    }
    const max = 'x'.repeat(2000)
    const created = await app.inject({ method: 'PUT', url: `/api/direct-income/${randomUUID()}`, payload: { ...payload, notes: ` ${max} ` } })
    expect(created.statusCode).toBe(201)
    expect(created.json().data.notes).toBe(max)
    await app.close()
  })

  it('keeps v3 income records without notes compatible with idempotent creates', async () => {
    const { app, store } = setup()
    const id = randomUUID(), url = `/api/direct-income/${id}`
    store.weekly.directIncomes.push({ ...payload, businessUnit: '5to Elemento', id, receivedDate: null, version: 1, createdBy: 'owner', createdAt: '2026-09-30T00:00:00Z' })
    const result = await app.inject({ method: 'PUT', url, payload: { ...payload, notes: null } })
    expect(result.statusCode).toBe(201)
    expect(store.weekly.directIncomes).toHaveLength(1)
    expect(store.weekly.schemaVersion).toBe(3)
    expect((await app.inject({ method: 'PUT', url, payload: { ...payload, notes: 'Cambio' } })).statusCode).toBe(409)
    await app.close()
  })

  it('reads previous v3 JSON with no incomes and unknown direct expense payment method', () => {
    const old = new DevelopmentStore().weekly as unknown as Record<string, unknown>
    delete old.directIncomes
    delete old.directIncomeAudit
    old.quickExpenses = [{ id: randomUUID(), name: 'Viejo', category: 'Otros gastos', amount: '1.00', expenseDate: '2026-09-01', businessUnit: 'SPL', createdBy: 'owner', createdAt: '2026-09-01T00:00:00Z' }]
    const upgraded = upgradeWeekly(old)
    expect(upgraded.directIncomes).toEqual([])
    expect(upgraded.directIncomeAudit).toEqual([])
    expect(upgraded.quickExpenses[0]).toMatchObject({ notes: '', paymentMethod: null })
  })
})
