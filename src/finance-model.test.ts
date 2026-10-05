import { describe, expect, it } from 'vitest'
import { financePeriodData, type FinanceEvent } from './finance-model'
import type { ApiDirectIncome } from './api'
import { dashboardPeriod } from './dashboard/period'

const event: FinanceEvent = { id: 'event', unit: 'SPL', client: 'Cliente', venue: 'Salón', date: '2026-08-19', price: 1000, payments: [{ id: 'payment', date: '2026-08-20', amount: 200 }, { id: 'refund', date: '2026-08-21', amount: 25, kind: 'refund' }], expenses: [{ id: 'partial', name: 'Renta', category: 'Renta de equipo', date: '2026-08-10', amount: 100, paid: 100, cashPayments: [{ date: '2026-08-11', amount: 20 }, { date: '2026-08-20', amount: 30 }, { date: '2026-08-28', amount: 50 }] }], laborItems: [{ id: 'labor:line:event:0', name: 'Trabajador', category: 'Nómina', context: 'Salón', kind: 'labor', date: '2026-08-24', amount: 100, cashDate: '2026-08-20', cashAmount: 90 }] }
const income = (receivedDate: string | null): ApiDirectIncome => ({ id: 'utility', name: 'Utilidad', amount: '80.00', businessUnit: 'SPL', expectedDate: '2026-08-22', receivedDate, version: 1, createdBy: 'owner', createdAt: '2026-08-01T12:00:00Z', notes: 'Referencia' })
const run = (incomes: ApiDirectIncome[] = []) => financePeriodData({ events: [event], incomes, quickExpenses: [], warehouseCosts: [], scope: 'Todos', period: dashboardPeriod('2026-08-18', 'week') })

describe('financial period snapshots', () => {
  it('counts partial payments by cash date and preserves the historical outstanding balance', () => {
    const data = run()
    expect(data.expenses[0]).toMatchObject({ amount: 100, paid: 30, pending: 50, paymentDates: ['2026-08-20'] })
    expect(data.expectedExpenses).toBe(0)
    expect(data.expectedLabor).toBe(100)
    expect(data.cashExpenses).toBe(30)
    expect(data.cashLabor).toBe(90)
    expect(data.cashResult).toBe(55)
    expect(data.expectedResult).toBe(900)
    expect(data.movements.find(movement => movement.type === 'Reembolso')).toMatchObject({ amount: -25, status: 'Reembolsado' })
  })
  it('shows an income received later as pending at the historical cutoff without counting cash twice', () => {
    const data = run([income('2026-08-26')])
    expect(data.agreed).toBe(1080)
    expect(data.received).toBe(175)
    expect(data.periodIncomes).toHaveLength(1)
    expect(data.movements.find(movement => movement.id === 'income:utility')).toMatchObject({ date: '2026-08-22', status: 'Pendiente', notes: 'Referencia' })
  })
  it('excludes fully settled old costs and another business from the selected snapshot', () => {
    const settled = { ...event, expenses: [{ ...event.expenses[0], cashPayments: [{ date: '2026-08-11', amount: 100 }] }] }
    const data = financePeriodData({ events: [settled, { ...event, id: 'fifth', unit: '5to Elemento' }], incomes: [], quickExpenses: [], warehouseCosts: [], scope: 'SPL', period: dashboardPeriod('2026-08-18', 'week') })
    expect(data.expenses).toHaveLength(0)
    expect(data.agreed).toBe(1000)
    expect(data.received).toBe(175)
  })
})
