import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Pool } from 'pg'
import { DataType, newDb } from 'pg-mem'
import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { PostgresEventRepository } from './repository.js'
import { PostgresPayrollStore } from './payroll.js'

const principal = { userId: 'date-test', role: 'owner' as const, unit: null }
const calendarDate = '2026-09-04'

async function setup() {
  const db = newDb()
  // pg-mem lacks PostgreSQL DATE formatting/casts; emulate only this explicit calendar-date overload.
  db.public.registerFunction({ name: 'to_char', args: [DataType.date, DataType.text], returns: DataType.text, implementation: (value: Date) => value.toISOString().slice(0, 10) })
  db.registerExtension('pgcrypto', schema => schema.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, implementation: randomUUID, impure: true }))
  db.public.registerFunction({ name: 'jsonb_typeof', args: [DataType.jsonb], returns: DataType.text, implementation: value => Array.isArray(value) ? 'array' : typeof value })
  for (const file of ['001_initial.sql', '004_event_corrections.sql', '007_event_deletion.sql']) db.public.none(await readFile(new URL(`./db/migrations/${file}`, import.meta.url), 'utf8'))
  const { Pool: MemoryPool } = db.adapters.createPg(), pool = new MemoryPool() as unknown as Pool
  const repository = new PostgresEventRepository(pool), payroll = new PostgresPayrollStore(pool)
  const app = buildApp(repository, async () => principal, undefined, undefined, payroll)
  const event = await repository.create({ businessUnit: 'SPL', clientName: 'Evento de prueba', venue: 'Lugar de prueba', eventDate: calendarDate, operationalStatus: 'Completado', agreedPrice: '100.00', payrollBudget: '0.00', extraExpenseBudget: '0.00' }, principal)
  return { pool, repository, app, event }
}

function expectTimestamp(value: unknown) { expect(value).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)) }

describe('PostgreSQL API calendar dates', () => {
  it('keeps completed payments included on the inclusive finance cutoff', async () => {
    const { pool, repository, app, event } = await setup()
    try {
      await repository.addPayment(event.id, { transactionDate: calendarDate, amount: '100.00', kind: 'payment', idempotencyKey: randomUUID() }, principal)
      const response = await app.inject(`/api/events/${event.id}/payments`)
      expect(response.statusCode).toBe(200)
      const payments = response.json().data
      // Use the same model as Finance; ISO timestamps previously excluded the end date and left 100 pending.
      const { financePeriodData } = await import('../src/' + 'finance-model.ts')
      const data = financePeriodData({ events: [{ id: event.id, unit: 'SPL', client: event.clientName, venue: event.venue, date: event.eventDate, price: Number(event.agreedPrice), expenses: [], laborItems: [], payments: payments.map((payment: { id: string; transactionDate: string; amount: string; kind: string }) => ({ id: payment.id, date: payment.transactionDate, amount: Number(payment.amount), kind: payment.kind })) }], incomes: [], quickExpenses: [], warehouseCosts: [], scope: 'Todos', period: { start: calendarDate, end: calendarDate, label: 'Cierre' } })
      expect(data.receivable).toBe(0)
      expect(data.received).toBe(100)
      expect(payments[0].transactionDate).toBe(calendarDate)
      expectTimestamp(payments[0].createdAt)
    } finally { await app.close(); await pool.end() }
  })

  it('returns calendar dates for create, correction and idempotent payment responses', async () => {
    const { pool, app, event } = await setup()
    try {
      const payload = { transactionDate: calendarDate, amount: '50.00', kind: 'payment', idempotencyKey: randomUUID() }
      const added = await app.inject({ method: 'POST', url: `/api/events/${event.id}/payments`, payload })
      expect(added.statusCode).toBe(201)
      const payment = added.json().data
      expect(payment.transactionDate).toBe(calendarDate)
      expectTimestamp(payment.createdAt)
      const corrected = await app.inject({ method: 'PATCH', url: `/api/payments/${payment.id}/correct`, payload: { transactionDate: '2026-09-05', amount: '75.00', version: 1, reason: 'Corrección de prueba' } })
      expect(corrected.statusCode).toBe(200)
      expect(corrected.json().data.transactionDate).toBe('2026-09-05')
      const repeated = await app.inject({ method: 'POST', url: `/api/events/${event.id}/payments`, payload })
      expect(repeated.json().data).toMatchObject({ id: payment.id, transactionDate: '2026-09-05' })
      const remainder = { transactionDate: '2026-09-06', idempotencyKey: randomUUID() }
      const full = await app.inject({ method: 'POST', url: `/api/events/${event.id}/pay-remaining`, payload: remainder })
      expect(full.statusCode).toBe(201)
      expect(full.json().data.transactionDate).toBe('2026-09-06')
      const again = await app.inject({ method: 'POST', url: `/api/events/${event.id}/pay-remaining`, payload: remainder })
      expect(again.json().data).toMatchObject({ id: full.json().data.id, transactionDate: '2026-09-06' })
    } finally { await app.close(); await pool.end() }
  })

  it('keeps expense, nullable due dates and settlement dates consistent in create/list/retry responses', async () => {
    const { pool, app, event } = await setup()
    try {
      const created = await app.inject({ method: 'POST', url: `/api/events/${event.id}/expenses`, payload: { name: 'Transporte', category: 'Transporte', expenseDate: calendarDate, amount: '25.00', dueDate: null } })
      expect(created.statusCode).toBe(201)
      const expense = created.json().data
      expect(expense).toMatchObject({ expenseDate: calendarDate, dueDate: null })
      const dated = await app.inject({ method: 'POST', url: `/api/events/${event.id}/expenses`, payload: { name: 'Comida', category: 'Alimentos', expenseDate: calendarDate, amount: '10.00', dueDate: '2026-09-05' } })
      expect(dated.json().data.dueDate).toBe('2026-09-05')
      const expenses = (await app.inject(`/api/events/${event.id}/expenses`)).json().data
      expect(expenses.find((item: { id: string }) => item.id === expense.id)).toMatchObject({ expenseDate: calendarDate, dueDate: null })
      expect(expenses.find((item: { id: string }) => item.id === dated.json().data.id)).toMatchObject({ expenseDate: calendarDate, dueDate: '2026-09-05' })
      const payload = { paymentDate: calendarDate, amount: '25.00', idempotencyKey: randomUUID() }
      const settled = await app.inject({ method: 'POST', url: `/api/expenses/${expense.id}/settlements`, payload })
      expect(settled.statusCode).toBe(201)
      expect(settled.json().data.paymentDate).toBe(calendarDate)
      expectTimestamp(settled.json().data.createdAt)
      const repeated = await app.inject({ method: 'POST', url: `/api/expenses/${expense.id}/settlements`, payload })
      expect(repeated.json().data).toMatchObject({ id: settled.json().data.id, paymentDate: calendarDate })
      expect((await app.inject('/api/expense-settlements')).json().data[0].paymentDate).toBe(calendarDate)
    } finally { await app.close(); await pool.end() }
  })

  it('provides strings for legacy payroll periods and settlement dates used by reports', async () => {
    const { pool, app } = await setup()
    try {
      const id = randomUUID()
      await pool.query('INSERT INTO payroll_entries(id,employee_name,period_start,period_end,base_cost,labor_cost,net_pay,paid_amount,created_by) VALUES($1,$2,$3,$4,$5,$5,$5,$5,$6)', [id, 'Trabajador de prueba', '2026-09-01', calendarDate, '100.00', principal.userId])
      await pool.query('INSERT INTO payroll_settlements(payroll_entry_id,payment_date,amount,idempotency_key,created_by) VALUES($1,$2,$3,$4,$5)', [id, calendarDate, '100.00', randomUUID(), principal.userId])
      const entries = (await app.inject('/api/payroll')).json().data
      expect(entries[0]).toMatchObject({ periodStart: '2026-09-01', periodEnd: calendarDate })
      const payments = await new PostgresPayrollStore(pool).listPayrollSettlements()
      expect(payments[0].paymentDate).toBe(calendarDate)
      expect(payments[0].paymentDate.startsWith('2026-09')).toBe(true)
    } finally { await app.close(); await pool.end() }
  })
})
