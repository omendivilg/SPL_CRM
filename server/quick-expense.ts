import { Decimal } from 'decimal.js'
import { z } from 'zod'
import type { Principal } from './domain.js'
import type { QuickExpense, WeeklyState } from './weekly.js'

export const quickExpenseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  amount: z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/).refine(value => new Decimal(value).gt(0)),
  expenseDate: z.iso.date(),
  businessUnit: z.enum(['SPL', '5to Elemento']),
  notes: z.string().trim().max(2000).default(''),
  paymentMethod: z.enum(['cash', 'card']),
}).strict()

export function saveQuickExpense(state: WeeklyState, id: string, raw: unknown, principal: Principal): QuickExpense {
  const input = quickExpenseSchema.parse(raw)
  const existing = state.quickExpenses.find(expense => expense.id === id)
  if (existing) {
    if (existing.name !== input.name || existing.category !== input.category || existing.amount !== new Decimal(input.amount).toFixed(2) || existing.expenseDate !== input.expenseDate || existing.businessUnit !== input.businessUnit || existing.notes !== input.notes || existing.paymentMethod !== input.paymentMethod) {
      throw Object.assign(new Error('Este gasto ya existe con datos diferentes.'), { statusCode: 409 })
    }
    return existing
  }
  const expense: QuickExpense = { ...input, id, amount: new Decimal(input.amount).toFixed(2), createdBy: principal.userId, createdAt: new Date().toISOString() }
  state.quickExpenses.push(expense)
  return expense
}
