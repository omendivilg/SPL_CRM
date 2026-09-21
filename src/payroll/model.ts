import { Decimal } from 'decimal.js'
import type { ApiTeamTemplate, WeeklyPayrollInput } from '../api'

export const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
export const cash = (value: string | number) => currency.format(Number(value))
export const decimal = (value: string) => new Decimal(value || 0)
export function localDate(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`
}
export function currentWeek() {
  const start = new Date(); start.setDate(start.getDate() - (start.getDay()+6)%7)
  const end = new Date(start); end.setDate(end.getDate()+6)
  return { periodStart: localDate(start), periodEnd: localDate(end) }
}
export type Editor = WeeklyPayrollInput & { id: string }
export const blank = (): Editor => ({ id: crypto.randomUUID(), version: 0, idempotencyKey: crypto.randomUUID(), ...currentWeek(), lines: [], expenses: [] })
export function applyTeam(editor: Editor, template: ApiTeamTemplate): Editor {
  return { ...editor, lines: template.lines.map(line => ({ ...line, id: crypto.randomUUID(), allocations: [{ scope: 'warehouse', amount: decimal(line.baseCost).plus(line.additions).toFixed(2) }] })), expenses: template.expenses.map(e => ({ ...e, id: crypto.randomUUID(), scope: 'warehouse' })) }
}
export function totals(editor: Pick<Editor, 'lines' | 'expenses'>) {
  const wages = editor.lines.reduce((sum, l) => sum.plus(decimal(l.baseCost).plus(l.additions || 0).minus(l.deductions || 0)), new Decimal(0))
  const expenses = editor.expenses.reduce((sum,e) => sum.plus(e.amount || 0), new Decimal(0))
  return { wages: wages.toFixed(2), expenses: expenses.toFixed(2), total: wages.plus(expenses).toFixed(2) }
}
export function validate(editor: Editor): string | null {
  if (!editor.periodStart || !editor.periodEnd || editor.periodEnd < editor.periodStart) return 'Revisa las fechas de la nómina.'
  if (!editor.lines.length) return 'Agrega al menos un trabajador.'
  const money = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/
  for (const line of editor.lines) {
    if (![line.baseCost,line.additions,line.deductions].every(value=>money.test(value))) return 'Completa los importes de cada trabajador con hasta dos decimales.'
    const labor = decimal(line.baseCost).plus(line.additions)
    if (labor.lte(0)) return 'El sueldo más las adiciones debe ser mayor que cero.'
    if (labor.lt(line.deductions)) return 'Las deducciones no pueden superar el sueldo más las adiciones.'
    if (!line.allocations.length || line.allocations.some(a=>!money.test(a.amount)||decimal(a.amount).lte(0))) return 'Completa todos los importes de la distribución.'
    if (!line.allocations.reduce((sum,a)=>sum.plus(a.amount),new Decimal(0)).eq(labor)) return 'La distribución de cada trabajador debe coincidir con su costo laboral.'
  }
  for (const expense of editor.expenses) if (!expense.concept.trim() || !money.test(expense.amount) || decimal(expense.amount).lte(0)) return 'Cada gasto necesita un concepto y un importe mayor que cero.'
  return null
}
