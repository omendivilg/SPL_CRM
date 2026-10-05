import type { ApiDirectIncome, ApiQuickExpense } from './api'
import type { DashboardCost } from './dashboard/DashboardCharts'
import { inPeriod, type DashboardPeriod } from './dashboard/period'
import { paidAmounts, type DatedAmount } from './dashboard/weekly'

type Unit = 'SPL' | '5to Elemento'
type Scope = Unit | 'Todos'
type Expense = { id: string; name: string; category: string; date: string; amount: number; paid: number; source?: 'payroll'; notes?: string | null; cashDate?: string; cashPayments?: DatedAmount[] }
export type FinanceEvent = { id: string; unit: Unit; client: string; venue: string; date: string; price: number | null; payments: { id: string; date: string; amount: number; kind?: 'payment' | 'refund' }[]; expenses: Expense[]; laborItems: DashboardCost[] }
export type FinanceExpense = { id: string; name: string; origin: string; category: string; date: string; amount: number; paid: number; pending: number; paymentDates: string[]; notes: string | null; paymentMethod: 'cash' | 'card' | null; businessUnit: Unit }
export type FinanceIncomeMovement = { id: string; name: string; context: string; date: string; amount: number; type: 'Cobro de evento' | 'Reembolso' | 'Utilidad' | 'Evento previsto'; status: 'Cobrado' | 'Pendiente' | 'Reembolsado'; notes: string | null }
type ExpenseSource = Omit<FinanceExpense, 'pending' | 'paymentDates'> & { cashDate?: string; cashPayments?: DatedAmount[] }
const scoped = (unit: Unit, scope: Scope) => scope === 'Todos' || unit === scope
const sum = (items: { amount: number }[]) => items.reduce((total, item) => total + Math.round(item.amount * 100), 0) / 100

export function financePeriodData({ events, incomes, quickExpenses, warehouseCosts, scope, period }: { events: FinanceEvent[]; incomes: ApiDirectIncome[]; quickExpenses: ApiQuickExpense[]; warehouseCosts: DashboardCost[]; scope: Scope; period: DashboardPeriod }) {
  const scopedEvents = events.filter(event => scoped(event.unit, scope))
  const scopedIncomes = incomes.filter(income => scoped(income.businessUnit, scope))
  const scopedWarehouse = warehouseCosts.filter(cost => scoped(cost.businessUnit ?? 'SPL', scope))
  const eventSources: ExpenseSource[] = scopedEvents.flatMap(event => event.expenses.map(expense => ({ ...expense, id: `event:${expense.id}`, origin: expense.source === 'payroll' ? `Nómina · ${event.venue}` : `Evento · ${event.venue}`, notes: expense.notes ?? null, paymentMethod: null, businessUnit: event.unit })))
  const directSources: ExpenseSource[] = quickExpenses.filter(expense => scoped(expense.businessUnit, scope)).map(expense => ({ id: `direct:${expense.id}`, name: expense.name, origin: 'Gasto directo', category: expense.category, date: expense.expenseDate, cashDate: expense.expenseDate, amount: Number(expense.amount), paid: Number(expense.amount), notes: expense.notes ?? null, paymentMethod: expense.paymentMethod ?? null, businessUnit: expense.businessUnit }))
  const warehouseSources: ExpenseSource[] = scopedWarehouse.filter(cost => cost.kind === 'expense').map(cost => ({ id: cost.id, name: cost.name, origin: 'Nómina · Almacén', category: cost.category, date: cost.date, amount: cost.amount, paid: cost.cashAmount ?? (cost.cashDate ? cost.amount : 0), cashDate: cost.cashDate, cashPayments: cost.cashPayments, notes: cost.notes ?? null, paymentMethod: null, businessUnit: cost.businessUnit ?? 'SPL' }))
  const sources = [...eventSources, ...directSources, ...warehouseSources]
  const expenses: FinanceExpense[] = sources.map(expense => {
    const payments = paidAmounts([{ ...expense, cashAmount: expense.paid }])
    const periodPayments = payments.filter(payment => inPeriod(payment.date, period))
    const paidAtCutoff = sum(payments.filter(payment => payment.date <= period.end))
    return { ...expense, paid: sum(periodPayments), pending: expense.date <= period.end ? Math.max(Math.round(expense.amount * 100) - Math.round(paidAtCutoff * 100), 0) / 100 : 0, paymentDates: periodPayments.map(payment => payment.date) }
  }).filter(expense => expense.paid > 0 || expense.pending > 0 || inPeriod(expense.date, period))
  const labor = [...scopedEvents.flatMap(event => event.laborItems), ...scopedWarehouse.filter(cost => cost.kind === 'labor')]
  const cashExpenses = sum(expenses.map(expense => ({ amount: expense.paid })))
  const cashLabor = sum(paidAmounts(labor).filter(payment => inPeriod(payment.date, period)))
  const expectedExpenses = sum(sources.filter(expense => inPeriod(expense.date, period)))
  const expectedLabor = sum(labor.filter(cost => inPeriod(cost.date, period)))
  const periodEvents = scopedEvents.filter(event => inPeriod(event.date, period))
  const periodIncomes = scopedIncomes.filter(income => inPeriod(income.receivedDate && income.receivedDate <= period.end ? income.receivedDate : income.expectedDate, period))
  const agreed = sum([...periodEvents.map(event => ({ amount: event.price ?? 0 })), ...periodIncomes.map(income => ({ amount: Number(income.amount) }))])
  const movements: FinanceIncomeMovement[] = scopedEvents.flatMap(event => {
    const entries: FinanceIncomeMovement[] = event.payments.filter(payment => inPeriod(payment.date, period)).map(payment => ({ id: `payment:${payment.id}`, name: event.client, context: `${event.venue} · ${event.unit}`, date: payment.date, amount: payment.kind === 'refund' ? -payment.amount : payment.amount, type: payment.kind === 'refund' ? 'Reembolso' : 'Cobro de evento', status: payment.kind === 'refund' ? 'Reembolsado' : 'Cobrado', notes: null }))
    const paidAtCutoff = sum(event.payments.filter(payment => payment.date <= period.end).map(payment => ({ amount: payment.kind === 'refund' ? -payment.amount : payment.amount })))
    const pending = Math.max(Math.round((event.price ?? 0) * 100) - Math.round(paidAtCutoff * 100), 0) / 100
    if (inPeriod(event.date, period) && pending > 0) entries.push({ id: `expected:${event.id}`, name: event.client, context: `${event.venue} · ${event.unit}`, date: event.date, amount: pending, type: 'Evento previsto', status: 'Pendiente', notes: null })
    return entries
  })
  for (const income of scopedIncomes) {
    const receivedInPeriod = income.receivedDate && inPeriod(income.receivedDate, period)
    const expectedInPeriod = inPeriod(income.expectedDate, period) && (!income.receivedDate || income.receivedDate > period.end)
    if (receivedInPeriod || expectedInPeriod) movements.push({ id: `income:${income.id}`, name: income.name, context: income.businessUnit, date: receivedInPeriod ? income.receivedDate! : income.expectedDate, amount: Number(income.amount), type: 'Utilidad', status: receivedInPeriod ? 'Cobrado' : 'Pendiente', notes: income.notes ?? null })
  }
  movements.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
  const received = sum(movements.filter(movement => movement.status !== 'Pendiente'))
  const receivableEvents = sum(scopedEvents.filter(event => event.date <= period.end).map(event => ({ amount: Math.max((event.price ?? 0) - sum(event.payments.filter(payment => payment.date <= period.end).map(payment => ({ amount: payment.kind === 'refund' ? -payment.amount : payment.amount }))), 0) })))
  const receivableIncomes = sum(scopedIncomes.filter(income => income.expectedDate <= period.end && (!income.receivedDate || income.receivedDate > period.end)).map(income => ({ amount: Number(income.amount) })))
  return { expenses, periodEvents, periodIncomes, movements, agreed, received, receivable: sum([{ amount: receivableEvents }, { amount: receivableIncomes }]), expectedExpenses, expectedLabor, cashExpenses, cashLabor, cashResult: sum([{ amount: received }, { amount: -cashExpenses }, { amount: -cashLabor }]), expectedResult: sum([{ amount: agreed }, { amount: -expectedExpenses }, { amount: -expectedLabor }]) }
}
