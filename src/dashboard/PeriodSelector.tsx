import { ChevronLeft, ChevronRight } from 'lucide-react'
import { dashboardPeriod, shiftFinancialPeriod, type SavedPeriod } from './period'
export type { SavedPeriod } from './period'

export function PeriodSelector({ value, onChange, today }: { value: SavedPeriod; onChange: (value: SavedPeriod) => void; today: string }) {
  const period = dashboardPeriod(value.anchor, value.mode)
  return <div className="dashboard-period">
    <div className="dashboard-period-mode" role="group" aria-label="Periodo financiero">
      <button type="button" className={value.mode === 'week' ? 'active' : ''} aria-pressed={value.mode === 'week'} onClick={() => onChange({ ...value, mode: 'week' })}>Semana</button>
      <button type="button" className={value.mode === 'month' ? 'active' : ''} aria-pressed={value.mode === 'month'} onClick={() => onChange({ ...value, mode: 'month' })}>Mes</button>
    </div>
    <div className="dashboard-period-nav">
      <button type="button" aria-label="Periodo anterior" onClick={() => onChange(shiftFinancialPeriod(value, -1))}><ChevronLeft size={18}/></button>
      <strong>{period.label}</strong>
      <button type="button" aria-label="Periodo siguiente" disabled={period.start >= dashboardPeriod(today, value.mode).start} onClick={() => onChange(shiftFinancialPeriod(value, 1))}><ChevronRight size={18}/></button>
    </div>
  </div>
}
