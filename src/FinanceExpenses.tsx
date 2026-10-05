import React from 'react'
import { EXPENSE_CATEGORIES } from './expense-categories'
import type { FinanceExpense } from './finance-model'
export type { FinanceExpense } from './finance-model'

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const compact = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 })
const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
const colors = ['#fb923c', '#f97316', '#ea580c', '#f87171', '#ef4444', '#c2410c', '#dc2626']
type ExpenseState = 'Todos' | 'Pagados' | 'Pendientes'

export function FinanceExpenses({ expenses, periodEnd }: { expenses: FinanceExpense[]; periodEnd: string }) {
  const [category, setCategory] = React.useState('Todas')
  const [state, setState] = React.useState<ExpenseState>('Pagados')
  const categories = [...EXPENSE_CATEGORIES, ...[...new Set(expenses.map(expense => expense.category))].filter(name => !EXPENSE_CATEGORIES.some(category => category === name)).sort((a, b) => a.localeCompare(b, 'es'))]
  const matching = expenses.filter(expense => category === 'Todas' || expense.category === category)
  const valueFor = (expense: FinanceExpense) => state === 'Pagados' ? expense.paid : state === 'Pendientes' ? expense.pending : expense.paid + expense.pending
  const grouped = categories.map((name, index) => ({ name, value: matching.filter(expense => expense.category === name).reduce((sum, expense) => sum + Math.round(valueFor(expense) * 100), 0) / 100, color: colors[index % colors.length] }))
  const maximum = Math.max(1, ...grouped.map(item => item.value))
  const filtered = matching.filter(expense => state === 'Todos' || valueFor(expense) > 0).sort((a, b) => (b.paymentDates.at(-1) ?? b.date).localeCompare(a.paymentDates.at(-1) ?? a.date) || a.name.localeCompare(b.name))
  const total = grouped.reduce((sum, item) => sum + Math.round(item.value * 100), 0) / 100
  const chartWidth = Math.max(720, grouped.length * 108 + 90)
  const baseline = 242
  const chartHeight = 190
  const stateLabel = state === 'Todos' ? 'pagados y pendientes' : state.toLocaleLowerCase('es')
  return <section className="panel finance-expenses" aria-label="Detalle de gastos">
    <div className="finance-expenses-head"><div><h2>Detalle de gastos</h2><p>Gastos de eventos, directos y de nómina. Los sueldos están en el resultado financiero.</p></div><strong>{filtered.length} registros · {money.format(total)}</strong></div>
    <div className="finance-expense-filters">
      <label>Categoría<select value={category} onChange={event => setCategory(event.target.value)}><option>Todas</option>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Estado<select value={state} onChange={event => setState(event.target.value as ExpenseState)}><option>Todos</option><option>Pagados</option><option>Pendientes</option></select></label>
    </div>
    <p className="finance-filter-explanation">Pagados: pagos realizados en el periodo. Pendientes: saldo por pagar al {date(periodEnd)}.</p>
    <p className="finance-chart-swipe-hint">Desliza la gráfica para ver todas las categorías.</p>
    <div className="finance-category-chart" role="img" aria-label="Gastos por categoría, pagados y pendientes" aria-description={`Vista seleccionada: ${stateLabel}. ${category === 'Todas' ? 'Todas las categorías' : category}. Total ${money.format(total)}.`}>
      <div className="finance-category-scroll"><svg viewBox={`0 0 ${chartWidth} 325`} style={{ minWidth: chartWidth }} aria-hidden="false">
        {[0, 1, 2, 3, 4].map(index => { const value = maximum * index / 4, y = baseline - index / 4 * chartHeight; return <g key={index}><line x1="70" x2={chartWidth - 20} y1={y} y2={y} className="finance-bar-grid"/><text x="60" y={y + 4} textAnchor="end" className="finance-bar-axis">{compact.format(value)}</text></g> })}
        {grouped.map((item, index) => {
          const x = 84 + index * (chartWidth - 98) / grouped.length
          const width = Math.min(64, (chartWidth - 98) / grouped.length - 22)
          const height = item.value / maximum * chartHeight
          const label = `${item.name}: ${money.format(item.value)} ${stateLabel}`
          const words = item.name.split(' ')
          const middle = Math.ceil(words.length / 2)
          const lines = words.length > 2 ? [words.slice(0, middle).join(' '), words.slice(middle).join(' ')] : [item.name]
          return <g key={item.name} className="finance-category-column" tabIndex={0} role="img" aria-label={label}><title>{label}</title><rect x={x} y={baseline - Math.max(height, 2)} width={width} height={Math.max(height, 2)} rx="6" fill={item.color} opacity={item.value === 0 ? 0.3 : 1}/><text x={x + width / 2} y={baseline - height - 10} textAnchor="middle" className="finance-bar-value">{money.format(item.value)}</text><text x={x + width / 2} y="267" textAnchor="middle" className="finance-bar-axis">{lines.map((line, lineIndex) => <tspan key={line} x={x + width / 2} dy={lineIndex === 0 ? 0 : 16}>{line}</tspan>)}</text></g>
        })}
      </svg></div>
    </div>
    <p className="finance-chart-caption">{state === 'Pagados' ? 'Pagos por categoría' : state === 'Pendientes' ? 'Saldos pendientes por categoría' : 'Pagos del periodo y saldos pendientes por categoría'} · {money.format(total)}</p>
    {filtered.length === 0 ? <div className="empty-state">No hay gastos con estos filtros.</div> : <div className="finance-expense-list">{filtered.map(expense => <article key={expense.id}><div><strong>{expense.name}</strong><span>{expense.origin} · {expense.category} · {expense.businessUnit} · Registrado {date(expense.date)}</span>{expense.paymentDates.length > 0 && <span>Pago{expense.paymentDates.length > 1 ? 's' : ''}: {[...new Set(expense.paymentDates)].map(date).join(', ')}</span>}{expense.notes && <p>{expense.notes}</p>}</div><div className="finance-expense-amount"><strong>{money.format(valueFor(expense))}</strong><span className={expense.pending === 0 ? 'expense-paid' : 'expense-pending'}>{expense.pending === 0 ? 'Pagado' : expense.paid > 0 ? 'Pago parcial' : 'Pendiente'}</span><small>Importe {money.format(expense.amount)}</small><small>Pagado en el periodo {money.format(expense.paid)} · Pendiente al cierre {money.format(expense.pending)}</small>{expense.origin === 'Gasto directo' && <small>{expense.paymentMethod === 'cash' ? 'Efectivo' : expense.paymentMethod === 'card' ? 'Tarjeta' : 'Forma de pago sin especificar'}</small>}</div></article>)}</div>}
  </section>
}
