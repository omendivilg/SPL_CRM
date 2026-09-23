import { z } from 'zod'

export type BusinessUnit = 'SPL' | '5to Elemento'
export type Role = 'admin' | 'owner' | 'coordinator'
export type Principal = { userId: string; role: Role; unit: BusinessUnit | null }

export type EventRecord = {
  id: string
  businessUnit: BusinessUnit
  clientName: string
  clientPhone: string | null
  venue: string
  eventDate: string
  operationalStatus: 'Pendiente' | 'Confirmado' | 'Completado' | 'Cancelado'
  operationalNotes: string | null
  financialNotes: string | null
  agreedPrice: string | null
  payrollBudget: string
  extraExpenseBudget: string
  version: number
  createdAt: string
  updatedAt: string
}

const text = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()
const money = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/, 'Debe ser un monto MXN válido con máximo dos decimales')

export const operationalEventSchema = z.object({
  businessUnit: z.literal('5to Elemento'),
  clientName: text(160),
  clientPhone: optionalText(40),
  venue: text(200),
  eventDate: z.iso.date(),
  operationalStatus: z.enum(['Pendiente', 'Confirmado', 'Completado', 'Cancelado']).default('Pendiente'),
  operationalNotes: optionalText(2000),
}).strict()

export const ownerEventSchema = z.object({
  businessUnit: z.enum(['SPL', '5to Elemento']),
  clientName: text(160),
  clientPhone: optionalText(40),
  venue: text(200),
  eventDate: z.iso.date(),
  operationalStatus: z.enum(['Pendiente', 'Confirmado', 'Completado', 'Cancelado']).default('Pendiente'),
  operationalNotes: optionalText(2000),
  financialNotes: optionalText(2000),
  agreedPrice: money.nullable().optional(),
  payrollBudget: money.default('0.00'),
  extraExpenseBudget: money.default('0.00'),
}).strict()

export const expenseSchema = z.object({
  name: text(200),
  category: text(100),
  expenseDate: z.iso.date(),
  amount: money,
  supplier: optionalText(200),
  notes: optionalText(2000),
  dueDate: z.iso.date().nullable().optional(),
}).strict()

export const paymentSchema=z.object({
  transactionDate:z.iso.date(),
  amount:money.refine(value=>Number(value)>0,'El monto debe ser mayor que cero'),
  kind:z.enum(['payment','refund']),
  idempotencyKey:z.uuid(),
}).strict()
export const settlementSchema=z.object({paymentDate:z.iso.date(),amount:money.refine(value=>Number(value)>0,'El monto debe ser mayor que cero'),idempotencyKey:z.uuid()}).strict()
export const eventBudgetSchema=z.object({payrollBudget:money}).strict()
export const agreedPriceSchema=z.object({agreedPrice:money.nullable(),version:z.number().int().positive()}).strict()
export const paymentCorrectionSchema=z.object({amount:money.refine(value=>Number(value)>0,'El monto debe ser mayor que cero'),transactionDate:z.iso.date(),reason:text(1000),version:z.number().int().positive()}).strict()
export const deleteVersionSchema=z.object({version:z.number().int().positive()}).strict()
export const payRemainingSchema=z.object({transactionDate:z.iso.date(),idempotencyKey:z.uuid()}).strict()

type CreateOwnerEvent = z.infer<typeof ownerEventSchema>
type CreateOperationalEvent = z.infer<typeof operationalEventSchema>
export type CreateEvent = CreateOwnerEvent | CreateOperationalEvent
export type CreateExpense = z.infer<typeof expenseSchema>
export type CreatePayment = z.infer<typeof paymentSchema>
export type CreateSettlement = z.infer<typeof settlementSchema>

export function toCoordinatorEvent(event: EventRecord) {
  return {
    id: event.id,
    businessUnit: event.businessUnit,
    clientName: event.clientName,
    clientPhone: event.clientPhone,
    venue: event.venue,
    eventDate: event.eventDate,
    operationalStatus: event.operationalStatus,
    operationalNotes: event.operationalNotes,
    version: event.version,
  }
}
