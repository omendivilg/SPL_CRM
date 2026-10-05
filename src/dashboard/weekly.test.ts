import { describe, expect, it } from 'vitest'
import { paidAmounts, tuesday, weeklySeries } from './weekly'

describe('weekly dashboard totals', () => {
  it('groups Tuesday through Monday, including refunds and losses', () => {
    expect(tuesday('2026-09-23')).toBe('2026-09-22')
    expect(tuesday('2026-09-21')).toBe('2026-09-15')
    const points = weeklySeries(
      [{ date: '2026-09-22', amount: 100 }, { date: '2026-09-28', amount: -20 }, { date: '2026-09-29', amount: 50 }],
      [{ date: '2026-09-22', amount: 90.25 }, { date: '2026-09-28', amount: 10 }],
      [{ date: '2026-09-28', amount: 30 }],
      '2026-09-23',
    )
    expect(points.at(-1)).toEqual({ start: '2026-09-22', end: '2026-09-28', incoming: 100, refunds: 20, received: 80, expenses: 100.25, payroll: 30, profit: -20.25 })
  })

  it('pages back by eight weeks without repeating a period', () => {
    const current = weeklySeries([], [], [], '2026-09-23')
    const previous = weeklySeries([], [], [], '2026-09-23', 1)
    expect(previous.at(-1)?.end).toBe('2026-08-03')
    expect(current[0].start).toBe('2026-08-04')
  })
  it('counts expenses in the payment week and leaves unpaid costs out of cash flow', () => {
    const costs = paidAmounts([
      { date:'2026-09-20', amount:100, cashDate:'2026-09-22' },
      { date:'2026-09-20', amount:200, cashDate:'2026-09-28', cashAmount:150 },
      { date:'2026-09-23', amount:300 },
      { date:'2026-09-20', amount:300, cashPayments:[{ date:'2026-09-15',amount:20 },{ date:'2026-09-29',amount:80 }] },
    ])
    expect(weeklySeries([],costs,[], '2026-09-23').at(-1)).toEqual({start:'2026-09-22',end:'2026-09-28',incoming:0,refunds:0,received:0,expenses:250,payroll:0,profit:-250})
  })
})
