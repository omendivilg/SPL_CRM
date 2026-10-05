import { Decimal } from 'decimal.js'
import { z } from 'zod'
import type { Principal } from './domain.js'
import type { DirectIncome, WeeklyState } from './weekly.js'

const amount = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/).refine(value => new Decimal(value).gt(0), 'El importe debe ser mayor que cero.')
const normalizeNotes = (value?: string | null) => value?.trim() || null
export const directIncomeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  amount,
  businessUnit: z.enum(['SPL', '5to Elemento']),
  expectedDate: z.iso.date(),
  receivedDate: z.iso.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional().transform(normalizeNotes),
}).strict().refine(value => !value.receivedDate || value.receivedDate === value.expectedDate, {
  path: ['receivedDate'], message: 'Al crear una utilidad pagada, la fecha de cobro debe coincidir con la fecha indicada.',
})
export const receiveDirectIncomeSchema = z.object({ receivedDate: z.iso.date(), version: z.number().int().positive() }).strict()
export const deleteDirectIncomeSchema = z.object({ version: z.number().int().positive() }).strict()

function conflict(message: string): never { throw Object.assign(new Error(message), { statusCode: 409 }) }
function record(state: WeeklyState, incomeId: string, actor: Principal, action: 'created' | 'received' | 'deleted', before: DirectIncome | null, after: DirectIncome) {
  state.directIncomeAudit.push({ incomeId, actor: actor.userId, at: new Date().toISOString(), action, before, after: structuredClone(after) })
}

export function saveDirectIncome(state: WeeklyState, id: string, raw: unknown, principal: Principal): DirectIncome {
  const input = directIncomeSchema.parse(raw)
  const normalizedAmount = new Decimal(input.amount).toFixed(2)
  const existing = state.directIncomes.find(income => income.id === id)
  if (existing) {
    const created = state.directIncomeAudit.find(audit => audit.incomeId === id && audit.action === 'created')
    const original = created?.after ?? existing
    if (existing.deletedAt || existing.name !== input.name || existing.amount !== normalizedAmount || existing.businessUnit !== input.businessUnit || existing.expectedDate !== input.expectedDate || original.receivedDate !== (input.receivedDate ?? null) || normalizeNotes(original.notes) !== input.notes) conflict('Esta utilidad ya existe con datos diferentes.')
    return existing
  }
  const now = new Date().toISOString()
  const income: DirectIncome = { id, name: input.name, amount: normalizedAmount, expectedDate: input.expectedDate, receivedDate: input.receivedDate ?? null, businessUnit: input.businessUnit, notes: input.notes, version: 1, createdBy: principal.userId, createdAt: now }
  if (income.receivedDate) { income.receivedBy = principal.userId; income.receivedAt = now }
  state.directIncomes.push(income)
  record(state, id, principal, 'created', null, income)
  return income
}

export function receiveDirectIncome(state: WeeklyState, id: string, raw: unknown, principal: Principal): DirectIncome | null {
  const input = receiveDirectIncomeSchema.parse(raw)
  const income = state.directIncomes.find(item => item.id === id && !item.deletedAt)
  if (!income) return null
  if (income.version !== input.version) conflict('La utilidad cambió. Recarga antes de registrar el cobro.')
  if (income.receivedDate) conflict('Esta utilidad ya fue cobrada.')
  const before = structuredClone(income)
  income.receivedDate = input.receivedDate
  income.receivedBy = principal.userId
  income.receivedAt = new Date().toISOString()
  income.version++
  record(state, id, principal, 'received', before, income)
  return income
}

export function deleteDirectIncome(state: WeeklyState, id: string, raw: unknown, principal: Principal): DirectIncome | null {
  const { version } = deleteDirectIncomeSchema.parse(raw)
  const income = state.directIncomes.find(item => item.id === id && !item.deletedAt)
  if (!income) return null
  if (income.version !== version) conflict('La utilidad cambió. Recarga antes de eliminarla.')
  const before = structuredClone(income)
  income.deletedAt = new Date().toISOString()
  income.deletedBy = principal.userId
  income.version++
  record(state, id, principal, 'deleted', before, income)
  return income
}
