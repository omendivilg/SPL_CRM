export type DatedAmount = { date: string; amount: number }
export type PayableAmount = DatedAmount & { cashDate?: string; cashAmount?: number; cashPayments?: DatedAmount[] }
export type WeeklyPoint = { start: string; end: string; incoming: number; refunds: number; received: number; expenses: number; payroll: number; profit: number }

export function paidAmounts<T extends PayableAmount>(items: T[]): T[] {
  return items.flatMap(item => item.cashPayments?.length
    ? item.cashPayments.filter(payment => payment.amount > 0).map(payment => ({ ...item, date: payment.date, amount: payment.amount }))
    : item.cashDate && (item.cashAmount ?? item.amount) > 0 ? [{ ...item, date: item.cashDate, amount: item.cashAmount ?? item.amount }] : [])
}

const iso = (date: Date) => date.toISOString().slice(0, 10)
const parse = (date: string) => new Date(`${date}T12:00:00Z`)
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000)

export function tuesday(date: string): string {
  const parsed = parse(date)
  return iso(addDays(parsed, -((parsed.getUTCDay() + 5) % 7)))
}

export function weeklySeries(receipts: DatedAmount[], costs: DatedAmount[], payrollCosts: DatedAmount[], currentDate: string, page = 0): WeeklyPoint[] {
  const current = parse(tuesday(currentDate))
  const first = addDays(current, -7 * (7 + Math.max(page, 0) * 8))
  return Array.from({ length: 8 }, (_, index) => {
    const start = iso(addDays(first, index * 7))
    const end = iso(addDays(first, index * 7 + 6))
    const sum = (items: DatedAmount[]) => items.filter(item => item.date >= start && item.date <= end).reduce((total, item) => total + Math.round(item.amount * 100), 0)
    const received = sum(receipts)
    const incoming = sum(receipts.filter(receipt => receipt.amount > 0))
    const refunds = Math.abs(sum(receipts.filter(receipt => receipt.amount < 0)))
    const expenses = sum(costs)
    const payroll = sum(payrollCosts)
    return { start, end, incoming: incoming / 100, refunds: refunds / 100, received: received / 100, expenses: expenses / 100, payroll: payroll / 100, profit: (received - expenses) / 100 }
  })
}
