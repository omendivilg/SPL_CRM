import { describe, expect, it } from 'vitest'
import { amountInPeriod, dashboardPeriod, inPeriod, isCalendarDate, shiftFinancialPeriod } from './period'

describe('dashboard period', () => {
  it('uses Tuesday through Monday and navigates by whole weeks', () => {
    expect(dashboardPeriod('2026-09-23', 'week')).toMatchObject({ start: '2026-09-22', end: '2026-09-28' })
    expect(dashboardPeriod('2026-09-23', 'week', -1)).toMatchObject({ start: '2026-09-15', end: '2026-09-21' })
    expect(dashboardPeriod('2026-09-28', 'week')).toMatchObject({ start: '2026-09-22', end: '2026-09-28' })
  })
  it('navigates month boundaries without rolling over into the wrong month', () => {
    expect(dashboardPeriod('2026-09-23', 'month', -1)).toMatchObject({ start: '2026-08-01', end: '2026-08-31' })
    expect(dashboardPeriod('2026-01-15', 'month', -1)).toMatchObject({ start: '2025-12-01', end: '2025-12-31' })
  })
  it('sums only money dated within the selected period', () => {
    const period = dashboardPeriod('2026-09-23', 'week')
    expect(inPeriod('2026-09-21', period)).toBe(false)
    expect(amountInPeriod([{ date: '2026-09-21', amount: 10 }, { date: '2026-09-22', amount: 0.1 }, { date: '2026-09-28', amount: 0.2 }, { date: '2026-09-29', amount: 20 }], period)).toBe(0.3)
  })
  it('rejects corrupt saved dates and keeps calendar navigation within the intended month', () => {
    expect(isCalendarDate('2026-02-30')).toBe(false)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('2028-02-29')).toBe(true)
    expect(isCalendarDate(null)).toBe(false)
    expect(shiftFinancialPeriod({ mode: 'month', anchor: '2026-01-31' }, 1)).toEqual({ mode: 'month', anchor: '2026-02-01' })
    expect(shiftFinancialPeriod({ mode: 'month', anchor: '2026-12-31' }, 1)).toEqual({ mode: 'month', anchor: '2027-01-01' })
    const selected = { mode: 'week' as const, anchor: '2026-08-18' }
    expect(dashboardPeriod(selected.anchor, 'month').start).toBe('2026-08-01')
    expect(dashboardPeriod(selected.anchor, 'week').start).toBe('2026-08-18')
  })
})
