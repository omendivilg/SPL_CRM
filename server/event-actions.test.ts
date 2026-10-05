import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { DevelopmentStore } from './dev.js'
import { PersistentDevelopmentStore } from './persistent-store.js'

const principal={userId:'owner',role:'owner' as const,unit:null}
const coordinator={userId:'coord',role:'coordinator' as const,unit:'5to Elemento' as const}
const headers={authorization:'owner'}

describe('event corrections',()=>{
  it('pays only the remaining agreed amount and removes prior abonos',async()=>{
    const store=new DevelopmentStore(),app=buildApp(store,async request=>request.headers.authorization==='coordinator'?coordinator:principal)
    const event=await store.create({businessUnit:'SPL',clientName:'Cliente',venue:'Salón',eventDate:'2026-09-20',operationalStatus:'Pendiente',agreedPrice:'100.00',payrollBudget:'0.00',extraExpenseBudget:'0.00'},principal)
    const first=await app.inject({method:'POST',url:`/api/events/${event.id}/payments`,headers,payload:{transactionDate:'2026-09-20',amount:'25.25',kind:'payment',idempotencyKey:randomUUID()}})
    expect(first.statusCode).toBe(201)
    const key=randomUUID(),payload={transactionDate:'2026-09-21',idempotencyKey:key}
    const full=await app.inject({method:'POST',url:`/api/events/${event.id}/pay-remaining`,headers,payload})
    expect(full.statusCode).toBe(201);expect(full.json().data.amount).toBe('74.75')
    expect((await app.inject({method:'POST',url:`/api/events/${event.id}/pay-remaining`,headers,payload})).json().data.id).toBe(full.json().data.id)
    expect((await app.inject({method:'POST',url:`/api/events/${event.id}/pay-remaining`,headers,payload:{...payload,idempotencyKey:randomUUID()}})).statusCode).toBe(409)
    expect((await app.inject({method:'DELETE',url:`/api/payments/${first.json().data.id}`,headers,payload:{version:1}})).statusCode).toBe(200)
    expect((await app.inject({method:'GET',url:`/api/events/${event.id}/payments`,headers})).json().data).toHaveLength(1)
    expect((await app.inject({method:'DELETE',url:`/api/payments/${full.json().data.id}`,headers:{authorization:'coordinator'},payload:{version:1}})).statusCode).toBe(403)
    await app.close()
  })
  it('removes a price and hides a deleted event from the agenda',async()=>{
    const store=new DevelopmentStore(),app=buildApp(store,async()=>principal)
    const event=await store.create({businessUnit:'SPL',clientName:'Cliente',venue:'Salón',eventDate:'2026-09-20',operationalStatus:'Pendiente',agreedPrice:'100.00',payrollBudget:'0.00',extraExpenseBudget:'0.00'},principal)
    const price=await app.inject({method:'PATCH',url:`/api/events/${event.id}/price`,headers,payload:{agreedPrice:null,version:1}})
    expect(price.json().data.agreedPrice).toBeNull()
    expect((await app.inject({method:'DELETE',url:`/api/events/${event.id}`,headers,payload:{version:1}})).statusCode).toBe(409)
    expect((await app.inject({method:'DELETE',url:`/api/events/${event.id}`,headers,payload:{version:2}})).statusCode).toBe(200)
    expect((await app.inject({method:'GET',url:'/api/events',headers})).json().data).toHaveLength(0)
    await app.close()
  })
  it('deletes a fully paid event while retaining its payment in the local audit data', async () => {
    const store = new DevelopmentStore(), app = buildApp(store, async () => principal)
    const event = await store.create({ businessUnit: 'SPL', clientName: 'Cliente', venue: 'Salón', eventDate: '2026-09-20', operationalStatus: 'Pendiente', agreedPrice: '100.00', payrollBudget: '0.00', extraExpenseBudget: '0.00' }, principal)
    const payment = await store.addPayment(event.id, { transactionDate: '2026-09-20', amount: '100.00', kind: 'payment', idempotencyKey: randomUUID() }, principal)
    expect(payment?.amount).toBe('100.00')
    expect((await app.inject({ method: 'DELETE', url: `/api/events/${event.id}`, headers, payload: { version: event.version } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/events', headers })).json().data).toHaveLength(0)
    expect(store.payments.get(event.id)).toHaveLength(1)
    await app.close()
  })
  it('keeps payment removal and event deletion after a local restart',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'spl-event-actions-')),path=join(directory,'data.json')
    try {
      const store=await PersistentDevelopmentStore.open(path)
      const event=await store.create({businessUnit:'SPL',clientName:'Cliente',venue:'Salón',eventDate:'2026-09-20',operationalStatus:'Pendiente',agreedPrice:'100.00',payrollBudget:'0.00',extraExpenseBudget:'0.00'},principal)
      const payment=await store.addPayment(event.id,{transactionDate:'2026-09-20',amount:'25.00',kind:'payment',idempotencyKey:randomUUID()},principal)
      expect(await store.deletePayment(payment!.id,1)).toBe(true)
      expect(await store.deleteEvent(event.id,1)).toBe(true)
      const reopened=await PersistentDevelopmentStore.open(path)
      expect(await reopened.list(principal)).toHaveLength(0)
      expect(reopened.payments.get(event.id)?.[0]).toHaveProperty('deletedAt')
    } finally { await rm(directory,{recursive:true,force:true}) }
  })
})
