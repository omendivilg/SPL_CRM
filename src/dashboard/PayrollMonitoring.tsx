import React from 'react'
import type { ApiPayroll, ApiWeeklyPayroll } from '../api'

type EventChoice = { id: string; venue: string }
const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })

export function PayrollMonitoring({ payroll, batches, events }: { payroll: ApiPayroll[]; batches: ApiWeeklyPayroll[]; events: EventChoice[] }) {
  const [query, setQuery] = React.useState('')
  const batchByLine = new Map(batches.flatMap(batch => batch.lines.map(line => [line.id, batch] as const)))
  const venueById = new Map(events.map(event => [event.id, event.venue] as const))
  const rows = payroll.map(line => {
    const batch = batchByLine.get(line.id)
    const payrollName = batch?.name || `${date(line.periodStart)} - ${date(line.periodEnd)}`
    const destinations = [...new Set(line.allocations.map(allocation => allocation.scope === 'warehouse' ? 'Almacén' : venueById.get(allocation.eventId ?? '') ?? 'Evento anterior'))]
    return { line, batch, payrollName, destination: destinations.join(', ') }
  }).filter(row => `${row.line.employeeName} ${row.payrollName} ${row.destination}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => b.line.periodEnd.localeCompare(a.line.periodEnd) || a.line.employeeName.localeCompare(b.line.employeeName))

  return <section className="panel payroll-monitor" aria-label="Trabajadores por nómina">
    <div className="payroll-monitor-head"><div><h2>Trabajadores por nómina</h2><p>Consulta individual de sueldos. El pago se registra para la nómina completa.</p></div><label>Buscar trabajador o nómina<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre o nómina" /></label></div>
    {rows.length === 0 ? <p className="payroll-monitor-empty">{query ? 'No hay trabajadores que coincidan con la búsqueda.' : 'Todavía no hay trabajadores en nóminas.'}</p> : <div className="finance-scroll"><table><thead><tr><th>Trabajador</th><th>Nómina</th><th>Periodo</th><th>Destino</th><th>Base</th><th>Adiciones</th><th>Deducciones</th><th>Neto</th><th>Estado</th></tr></thead><tbody>{rows.map(({ line, batch, payrollName, destination }) => <tr key={line.id}><td data-label="Trabajador"><strong>{line.employeeName}</strong></td><td data-label="Nómina"><strong>{payrollName}</strong></td><td data-label="Periodo">{date(line.periodStart)} - {date(line.periodEnd)}</td><td data-label="Destino">{destination}</td><td data-label="Base">{money.format(Number(line.baseCost))}</td><td data-label="Adiciones">{money.format(Number(line.additions))}</td><td data-label="Deducciones">{money.format(Number(line.deductions))}</td><td data-label="Neto" className="payroll-monitor-net">{money.format(Number(line.netPay))}</td><td data-label="Estado"><span className={`pr-status ${batch?.status === 'paid' ? 'paid' : ''}`}>{batch ? batch.status === 'paid' ? 'Pagada' : 'No pagada' : 'Histórico'}</span></td></tr>)}</tbody></table></div>}
  </section>
}
