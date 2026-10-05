import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DevelopmentStore } from './dev.js'
import { buildApp } from './app.js'

describe('standalone quick expenses', () => {
  it('saves a paid expense once, lists it by payment date, and restricts coordinators', async () => {
    const store = new DevelopmentStore()
    const app = buildApp(store, async request => request.headers.authorization === 'coordinator' ? { userId: 'coord', role: 'coordinator', unit: '5to Elemento' } : { userId: 'owner', role: 'owner', unit: null }, undefined, undefined, store, store)
    const id = randomUUID(), url = `/api/quick-expenses/${id}`
    const payload = { name: 'Gasolina', category: 'Transporte', amount: '125.50', expenseDate: '2026-09-22', businessUnit: 'SPL', notes: 'Viaje a evento', paymentMethod: 'card' }
    expect((await app.inject({ method: 'PUT', url, headers: { authorization: 'coordinator' }, payload })).statusCode).toBe(403)
    const first = await app.inject({ method: 'PUT', url, payload })
    expect(first.statusCode).toBe(201)
    expect(first.json().data).toMatchObject({ id, amount: '125.50', expenseDate: '2026-09-22', notes: 'Viaje a evento', paymentMethod: 'card' })
    expect((await app.inject({ method: 'PUT', url, payload })).json().data.id).toBe(id)
    expect((await app.inject({ method: 'GET', url: '/api/quick-expenses' })).json().data).toHaveLength(1)
    expect((await app.inject({ method: 'PUT', url, payload: { ...payload, amount: '200.00' } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'PUT', url, payload: { ...payload, paymentMethod: 'cash' } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'PUT', url: `/api/quick-expenses/${randomUUID()}`, payload: { ...payload, amount: '-1.00' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: `/api/quick-expenses/${randomUUID()}`, payload: { ...payload, businessUnit: 'SPL consolidado' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: `/api/quick-expenses/${randomUUID()}`, payload: { ...payload, paymentMethod: 'wire' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: `/api/quick-expenses/${randomUUID()}`, payload: { ...payload, paymentMethod: null } })).statusCode).toBe(400)
    const { paymentMethod, ...withoutMethod } = payload
    expect((await app.inject({ method: 'PUT', url: `/api/quick-expenses/${randomUUID()}`, payload: withoutMethod })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/quick-expenses', headers: { authorization: 'coordinator' } })).statusCode).toBe(403)
    await app.close()
  })
})
