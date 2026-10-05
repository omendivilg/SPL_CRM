import { tuesday, type DatedAmount } from './weekly'

export type DashboardPeriod = { start: string; end: string; label: string }
export type DashboardPeriodMode = 'week' | 'month'
export type SavedPeriod = { mode: DashboardPeriodMode; anchor: string }

const iso = (date: Date) => date.toISOString().slice(0, 10)
const date = (value: string) => new Date(`${value}T12:00:00Z`)
const day = (value: string, difference: number) => iso(new Date(date(value).getTime() + difference * 86_400_000))
const longDate = (value: string) => date(value).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = date(value)
  return Number.isFinite(parsed.getTime()) && iso(parsed) === value
}

export function dashboardPeriod(today: string, mode: DashboardPeriodMode, offset = 0): DashboardPeriod {
  if (mode === 'week') {
    const start = day(tuesday(today), offset * 7)
    const end = day(start, 6)
    return { start, end, label: `${longDate(start)} - ${longDate(end)}` }
  }
  const current = date(today)
  const startDate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + offset, 1, 12))
  const start = iso(startDate)
  const end = iso(new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0, 12)))
  return { start, end, label: startDate.toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' }) }
}

export const inPeriod = (value: string, period: DashboardPeriod) => value >= period.start && value <= period.end
export const amountInPeriod = (values: DatedAmount[], period: DashboardPeriod) => values.filter(value => inPeriod(value.date, period)).reduce((sum, value) => sum + Math.round(value.amount * 100), 0) / 100

export function shiftFinancialPeriod(value: SavedPeriod, amount: number): SavedPeriod {
  return { ...value, anchor: dashboardPeriod(value.anchor, value.mode, amount).start }
}
