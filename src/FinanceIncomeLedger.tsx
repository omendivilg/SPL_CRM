import type { FinanceIncomeMovement } from './finance-model'

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })

export function FinanceIncomeLedger({ movements, id }: { movements: FinanceIncomeMovement[]; id: string }) {
  return <section className="finance-income-ledger" id={id} aria-label="Entradas del periodo">
    <div className="finance-ledger-heading"><h3>Entradas del periodo</h3><p>Cobros y reembolsos por su fecha real. Los ingresos previstos aparecen pendientes.</p></div>
    {movements.length === 0 ? <p className="dashboard-empty">No hay entradas registradas o previstas en este periodo.</p> : <div className="finance-ledger-list">{movements.map(movement => <article key={movement.id} className={movement.type === 'Reembolso' ? 'finance-ledger-refund' : ''}>
      <time className="finance-ledger-date" dateTime={movement.date}>{date(movement.date)}</time><div className="finance-ledger-description"><strong>{movement.name}</strong><span>{movement.type} · {movement.context}</span>{movement.notes && <p>{movement.notes}</p>}</div><div className="finance-ledger-value"><strong>{money.format(movement.amount)}</strong><span className={movement.status === 'Pendiente' ? 'expense-pending' : movement.status === 'Reembolsado' ? 'finance-refund-label' : 'expense-paid'}>{movement.status}</span></div>
    </article>)}</div>}
  </section>
}
