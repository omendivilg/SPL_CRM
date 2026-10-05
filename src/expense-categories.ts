export const EXPENSE_CATEGORIES = [
  'Otros gastos',
  'Renta de equipo',
  'Compra de equipo',
  'Transporte',
  'Alimentos',
  'Materiales',
  'Servicios',
] as const

export const DEFAULT_EXPENSE_CATEGORY = 'Otros gastos'
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]
