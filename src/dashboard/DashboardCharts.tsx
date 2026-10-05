import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { paidAmounts, weeklySeries, type DatedAmount } from './weekly'

export type DashboardCost = DatedAmount & { id: string; name: string; category: string; context: string; kind: 'expense' | 'labor'; businessUnit?: 'SPL' | '5to Elemento'; payrollOrigin?: boolean; notes?: string | null; cashDate?: string; cashAmount?: number; cashPayments?: DatedAmount[] }

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const compact = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 })
const colors = ['#f97316', '#38bdf8', '#a78bfa', '#4adea1', '#fbbf24', '#fb7185', '#94a3b8', '#22d3ee']
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })

export function CostBreakdown({ costs }: { costs: DashboardCost[] }) {
  const [focused,setFocused]=React.useState<string|null>(null)
  const detailedExpenses = costs.filter(cost => cost.kind === 'expense')
  const categories = [...new Set(costs.map(cost => cost.category))].map((name, index) => ({
    name,
    amount: costs.filter(cost => cost.category === name).reduce((sum, cost) => sum + Math.round(cost.amount * 100), 0) / 100,
    color: colors[index % colors.length],
  })).sort((a, b) => b.amount - a.amount)
  const total = categories.reduce((sum, item) => sum + item.amount, 0)
  let cumulative = 0
  const segments = categories.map(item => {
    const start = cumulative
    cumulative += total ? item.amount / total * 100 : 0
    return { ...item, start, percent: total ? item.amount / total * 100 : 0 }
  })
  const highlighted = segments.find(item=>item.name===focused)

  return <section className="panel dashboard-costs" aria-label="Gasto por categoría">
    <div className="panel-head"><div><h2>Gasto por categoría</h2><p>Cada partida registrada, con su nombre y categoría</p></div></div>
    <div className="dashboard-cost-layout">
      <div className="dashboard-cost-summary">
        <div className="donut-row"><div className="donut" aria-label={`Gasto total ${money.format(total)}`}><svg viewBox="0 0 120 120" role="group" aria-label="Gastos por categoría"><circle cx="60" cy="60" r="48" fill="none" stroke="#29313d" strokeWidth="23"/>{segments.map(item=><circle key={item.name} cx="60" cy="60" r="48" fill="none" stroke={item.color} strokeWidth={focused===item.name?29:23} strokeDasharray={`${item.percent*3.01593} ${301.593-item.percent*3.01593}`} strokeDashoffset={-item.start*3.01593} transform="rotate(-90 60 60)" className="donut-segment" tabIndex={0} role="img" aria-label={`${item.name}: ${money.format(item.amount)}, ${Math.round(item.percent)}%`} onMouseEnter={()=>setFocused(item.name)} onMouseLeave={()=>setFocused(null)} onFocus={()=>setFocused(item.name)} onBlur={()=>setFocused(null)}><title>{item.name}: {money.format(item.amount)} ({Math.round(item.percent)}%)</title></circle>)}</svg><div aria-live="polite"><strong>{money.format(highlighted?.amount??total)}</strong><span>{highlighted?.name??'Total'}</span></div></div></div>
        <div className="category-list">{categories.length === 0 ? <p className="dashboard-empty">Todavía no hay gastos pagados en este periodo.</p> : categories.map(item => <div className={focused===item.name?'active':''} key={item.name}><span><i style={{ background: item.color }} />{item.name}</span><strong>{money.format(item.amount)}</strong><small>{total ? Math.round(item.amount / total * 100) : 0}%</small></div>)}</div>
      </div>
      <div className="dashboard-cost-detail"><h3>Detalle de gastos <span>{detailedExpenses.length}</span></h3>
        {detailedExpenses.length === 0 ? <p className="dashboard-empty">Los gastos pagados aparecerán aquí en su periodo.</p> : <div className="dashboard-cost-rows">{[...detailedExpenses].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name)).map((cost,index) => <div className="dashboard-cost-row" key={`${cost.id}:${cost.date}:${index}`}><div><strong>{cost.name}</strong><span>{cost.category} · {cost.context} · {dateLabel(cost.date)}</span></div><b>{money.format(cost.amount)}</b></div>)}</div>}
      </div>
    </div>
  </section>
}

export function WeeklyComparison({ receipts, costs, today }: { receipts: DatedAmount[]; costs: DashboardCost[]; today: string }) {
  const [page, setPage] = React.useState(0)
  type Metric = 'incoming' | 'expenses' | 'profit' | 'payroll'
  type LineMetric = Exclude<Metric, 'payroll'>
  const [tooltip, setTooltip] = React.useState<{ index: number; metric: Metric } | null>(null)
  React.useEffect(() => { setPage(0); setTooltip(null) }, [today])
  const paidCosts = paidAmounts(costs).filter(cost => cost.date <= today)
  const weeks = weeklySeries(receipts.filter(receipt => receipt.date <= today), paidCosts, paidCosts.filter(cost => cost.kind === 'labor' || cost.payrollOrigin), today, page)
  const maximum = Math.max(0, ...weeks.flatMap(week => [week.incoming, week.expenses, week.payroll, week.profit]))
  const minimum = Math.min(0, ...weeks.map(week => week.profit))
  const span = Math.max(maximum - minimum, 1)
  const y = (value: number) => 200 - (value - minimum) / span * 155
  const x = (index: number) => 73 + index * 94
  const lineMetrics: LineMetric[] = ['expenses', 'incoming', 'profit']
  const pointX = (week: typeof weeks[number], index: number, metric: LineMetric) => lineMetrics.some(other => other !== metric && Math.abs(y(week[other]) - y(week[metric])) < 11) ? x(index) + (lineMetrics.indexOf(metric) - 1) * 8 : x(index)
  const points = (metric: LineMetric) => weeks.map((week, index) => `${x(index)},${y(week[metric])}`).join(' ')
  const metricName = { incoming: 'Entradas', expenses: 'Gastos', profit: 'Ganancia', payroll: 'Nómina' } as const
  const className = { incoming: 'weekly-receipt', expenses: 'weekly-expense', profit: 'weekly-profit' } as const
  const showTooltip = (index: number, metric: Metric) => setTooltip({ index, metric })
  const activeWeek = tooltip && weeks[tooltip.index]
  const tooltipX = tooltip ? Math.min(Math.max(x(tooltip.index) - 95, 54), 565) : 0
  const tooltipAnchorY = tooltip ? y(weeks[tooltip.index][tooltip.metric]) : 0
  const tooltipY = tooltipAnchorY < 106 ? tooltipAnchorY + 13 : tooltipAnchorY - 58
  const first = dateLabel(weeks[0].start)
  const last = dateLabel(weeks[7].end)
  return <section className="panel weekly-panel" aria-label="Gastos y ganancias por semana">
    <div className="panel-head weekly-head"><div><h2>Gastos y ganancias por semana</h2><p>Entradas incluye todos los cobros de eventos y utilidades. Ganancia = entradas menos reembolsos y gastos. Los gastos incluyen nóminas.</p></div><div className="weekly-controls"><button type="button" onClick={() => setPage(value => value + 1)} aria-label="Ver ocho semanas anteriores"><ChevronLeft size={18}/></button><span>{first} - {last}</span><button type="button" onClick={() => setPage(value => Math.max(value - 1, 0))} disabled={page === 0} aria-label="Ver ocho semanas siguientes"><ChevronRight size={18}/></button></div></div>
    <div className="weekly-legend"><span><i className="weekly-receipt-dot"/>Entradas</span><span><i className="weekly-expense-dot"/>Gastos</span><span><i className="weekly-profit-dot"/>Ganancia neta</span><span><i className="weekly-payroll-dot"/>Nómina</span></div>
    <p className="weekly-swipe-hint">Desliza la gráfica para ver todas las semanas.</p>
    <div className="weekly-chart-scroll"><svg viewBox="0 0 810 250" role="img" aria-label={`Gráfica semanal de entradas, gastos y ganancias entre ${first} y ${last}`}>
      {[0, 1, 2, 3, 4].map(index => { const value = minimum + span * index / 4; return <g key={index}><line x1="52" x2="755" y1={y(value)} y2={y(value)} className={Math.abs(value) < 0.01 ? 'weekly-zero' : 'weekly-gridline'}/><text x="45" y={y(value) + 4} textAnchor="end" className="weekly-axis">{compact.format(value)}</text></g> })}
      {weeks.map((week, index) => { const label = `${dateLabel(week.start)} - ${dateLabel(week.end)} · Nómina ${money.format(week.payroll)}`; return <rect key={week.start} x={x(index) - 17} y={y(week.payroll)} width="34" height={Math.max(y(0) - y(week.payroll), 0)} rx="4" className="weekly-payroll-bar weekly-interactive" tabIndex={0} role="img" aria-label={label} onMouseEnter={() => showTooltip(index, 'payroll')} onMouseLeave={() => setTooltip(null)} onFocus={() => showTooltip(index, 'payroll')} onBlur={() => setTooltip(null)}/> })}
      {lineMetrics.map(metric => <polyline key={metric} points={points(metric)} className={`${className[metric]}-line`}/>)}
      {weeks.map((week, index) => { const period = `${dateLabel(week.start)} - ${dateLabel(week.end)}`; return <g key={week.start}>{lineMetrics.map(metric => <circle key={metric} cx={pointX(week, index, metric)} cy={y(week[metric])} r="5" tabIndex={0} role="img" aria-label={`${period} · ${metricName[metric]} ${money.format(week[metric])}`} onMouseEnter={() => showTooltip(index, metric)} onMouseLeave={() => setTooltip(null)} onFocus={() => showTooltip(index, metric)} onBlur={() => setTooltip(null)} className={`${className[metric]}-point weekly-interactive`}/>)}<text x={x(index)} y="235" textAnchor="middle" className="weekly-axis">{dateLabel(week.start)}</text></g> })}
      {tooltip && activeWeek && <g className="weekly-tooltip" role="status" transform={`translate(${tooltipX} ${tooltipY})`}><rect width="190" height="46" rx="7"/><text x="9" y="17" className="weekly-tooltip-period">{dateLabel(activeWeek.start)} - {dateLabel(activeWeek.end)}</text><text x="9" y="36" className="weekly-tooltip-value">{metricName[tooltip.metric]} {money.format(activeWeek[tooltip.metric])}</text></g>}
    </svg></div>
    <div className="weekly-table-scroll"><table className="weekly-table"><thead><tr><th>Semana</th><th>Entradas</th><th>Reembolsos</th><th>Cobros netos</th><th>Gastos</th><th>Nómina</th><th>Ganancia</th></tr></thead><tbody>{weeks.map(week => <tr key={week.start}><td>{dateLabel(week.start)} - {dateLabel(week.end)}</td><td data-label="Entradas">{money.format(week.incoming)}</td><td data-label="Reembolsos">{money.format(week.refunds)}</td><td data-label="Cobros">{money.format(week.received)}</td><td data-label="Gastos">{money.format(week.expenses)}</td><td data-label="Nómina">{money.format(week.payroll)}</td><td data-label="Ganancia" className={week.profit < 0 ? 'weekly-loss' : 'weekly-gain'}>{money.format(week.profit)}</td></tr>)}</tbody></table></div>
  </section>
}
