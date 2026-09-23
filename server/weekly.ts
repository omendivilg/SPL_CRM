import { createHash, randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import { z } from 'zod'
import type { Principal } from './domain.js'
import { calculatePayroll, type PayrollRecord, type PayrollSettlement, type PayrollTemplate, type WorkerRecord } from './payroll.js'

const amount = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/, 'Usa un monto válido con hasta dos decimales.')
const positive = amount.refine(value => new Decimal(value).gt(0), 'El importe debe ser mayor que cero.')
const destination = { scope: z.enum(['warehouse', 'event']), eventId: z.uuid().nullable().optional() }
const weeklyLineSchema = z.object({
  id: z.uuid(), employeeId: z.uuid(), baseCost: amount, additions: amount, deductions: amount,
  allocations: z.array(z.object({ ...destination, amount: positive }).strict()).min(1).max(100),
}).strict()
const generalExpenseSchema = z.object({
  id: z.uuid(), concept: z.string().trim().min(1).max(200), amount: positive,
  notes: z.string().trim().max(1000).default(''), ...destination,
}).strict()
const weeklyInputSchema = z.object({
  id: z.uuid(), version: z.number().int().min(0), idempotencyKey: z.uuid(),
  periodStart: z.iso.date(), periodEnd: z.iso.date(), lines: z.array(weeklyLineSchema).max(100),
  expenses: z.array(generalExpenseSchema).max(100),
}).strict().refine(input => input.lines.length + input.expenses.length > 0, 'Agrega un trabajador o un gasto.')
const teamInputSchema = z.object({
  id: z.uuid(), version: z.number().int().min(0), idempotencyKey: z.uuid(), name: z.string().trim().min(1).max(120),
  isDefault: z.boolean(), lines: z.array(weeklyLineSchema.omit({ id: true, allocations: true })).min(1).max(100),
  expenses: z.array(generalExpenseSchema.omit({ id: true, scope: true, eventId: true })).max(100),
}).strict()
const paymentInputSchema = z.object({ version: z.number().int().min(1), idempotencyKey: z.uuid(), paymentDate: z.iso.date() }).strict()
const reversalInputSchema = z.object({ version: z.number().int().min(1), idempotencyKey: z.uuid(), reason: z.string().trim().min(1).max(1000) }).strict()
const deleteInputSchema = z.object({ version: z.number().int().min(1) }).strict()
export type WeeklyInput = z.infer<typeof weeklyInputSchema>
export type TeamInput = z.infer<typeof teamInputSchema>
export type GeneralExpense = z.infer<typeof generalExpenseSchema>
export type Audit = { actor: string; at: string; reason: string; before: unknown; after: unknown }
export type WeeklyLine = Omit<PayrollRecord, 'paidAmount' | 'outstandingAmount'> & { employeeId: string }
export type BatchPayment = { id: string; paymentDate: string; amount: string; actor: string; at: string; reversedAt?: string; reversalReason?: string }
export type Operation = { key: string; fingerprint: string }
export type WeeklyBatch = {
  id: string; version: number; periodStart: string; periodEnd: string; status: 'unpaid' | 'paid'; historical?: boolean;
  lines: WeeklyLine[]; expenses: GeneralExpense[]; wagesTotal: string; expensesTotal: string; total: string;
  history: Audit[]; payments: BatchPayment[]; operations: Operation[];
}
export type TeamTemplate = Omit<TeamInput, 'idempotencyKey'> & { operations: Operation[] }
export type LegacyEntry = PayrollRecord & { archivedDraft?: boolean }
export type WeeklyState = { schemaVersion: 2; batches: WeeklyBatch[]; templates: TeamTemplate[]; migrated: boolean; legacy: LegacyEntry[]; legacySettlements: PayrollSettlement[]; importedWorkers: WorkerRecord[]; archive: unknown[] }
export interface WeeklyStore {
  readWeekly(): Promise<WeeklyState>
  transactWeekly<T>(operation: (state: WeeklyState) => T | Promise<T>): Promise<T>
}
export const emptyWeekly = (): WeeklyState => ({ schemaVersion: 2, batches: [], templates: [], migrated: false, legacy: [], legacySettlements: [], importedWorkers: [], archive: [] })
function conflict(message: string): never { throw Object.assign(new Error(message), { statusCode: 409 }) }
const audit = (principal: Principal, reason: string, before: unknown, after: unknown): Audit => ({ actor: principal.userId, at: new Date().toISOString(), reason, before: structuredClone(before), after: structuredClone(after) })
const fingerprint = (raw: unknown) => createHash('sha256').update(JSON.stringify(raw)).digest('hex')
function repeated(operations: Operation[], key: string, raw: unknown) {
  const prior = operations.find(op => op.key === key)
  if (prior && prior.fingerprint !== fingerprint(raw)) conflict('La solicitud cambió. Recarga antes de reintentar.')
  return Boolean(prior)
}
const operation = (key: string, raw: unknown): Operation => ({ key, fingerprint: fingerprint(raw) })
const date = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
const stableId = (value: string) => { const hash = createHash('sha256').update(value).digest('hex'); return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}` }

// Upgrade the previous experimental model without inventing full payments or losing drafts.
export function upgradeWeekly(raw: unknown): WeeklyState {
  if (!raw || typeof raw !== 'object') throw new Error('El archivo de nóminas no es válido.')
  const old = raw as Record<string, any>
  if (old.schemaVersion === 2) {
    for (const key of ['batches','templates','legacy','legacySettlements','importedWorkers','archive']) if (!Array.isArray(old[key])) throw new Error('El archivo de nóminas no es válido.')
    return structuredClone(old) as WeeklyState
  }
  const state = emptyWeekly()
  if (!Object.keys(old).length) return state
  if (!Array.isArray(old.batches) || !Array.isArray(old.templates)) throw new Error('El archivo de nóminas no es válido.')
  state.archive = [structuredClone(raw)]
  for (const batch of old.batches) {
    for (const line of batch.lines ?? []) {
      state.legacy.push({ ...line, periodStart: date(line.periodStart), periodEnd: date(line.periodEnd), archivedDraft: batch.status === 'draft' })
      if (line.employeeId && !state.importedWorkers.some(w => w.id === line.employeeId)) state.importedWorkers.push({id:line.employeeId,name:line.employeeName,active:true})
    }
    state.legacySettlements.push(...(batch.settlements ?? []))
  }
  state.templates = old.templates.map((item: any) => ({ ...item, expenses: [], operations: [] }))
  return state
}

export function migrateWeekly(state: WeeklyState, payroll: PayrollRecord[], templates: PayrollTemplate[], workers: WorkerRecord[], settlements: PayrollSettlement[]) {
  if (state.migrated) return
  for (const entry of payroll) if (!state.legacy.some(l => l.id === entry.id)) state.legacy.push({ ...entry, periodStart: date(entry.periodStart), periodEnd: date(entry.periodEnd) })
  for (const entry of settlements) if (!state.legacySettlements.some(s => s.id === entry.id)) state.legacySettlements.push({ ...entry, paymentDate: date(entry.paymentDate) })
  for (const template of templates) {
    if (state.templates.some(t => t.id === template.id)) continue
    let worker = workers.find(w => w.id === template.employeeId)
    if (!worker) {
      worker = { id: template.employeeId ?? stableId(`template:${template.id}`), name: `Trabajador de ${template.name}`, active: true }
      state.importedWorkers.push(worker)
    }
    state.templates.push({ id: template.id, version: 1, name: template.name, isDefault: false, lines: [{ employeeId: worker.id, baseCost: template.baseCost, additions: template.additions, deductions: template.deductions }], expenses: [], operations: [] })
  }
  for (const template of state.templates) for (const line of template.lines) {
    if (![...workers,...state.importedWorkers].some(w=>w.id===line.employeeId)) state.importedWorkers.push({id:line.employeeId,name:`Trabajador de ${template.name}`,active:true})
  }
  state.migrated = true
}
function checkDestination(item: { scope: string; eventId?: string | null }, eventIds: Set<string>) {
  if (item.scope === 'event' && (!item.eventId || !eventIds.has(item.eventId))) conflict('El evento asignado no existe.')
  if (item.scope === 'warehouse' && item.eventId) conflict('Almacén no admite un evento.')
}
export function saveWeekly(state: WeeklyState, raw: unknown, workers: WorkerRecord[], eventIds: Set<string>, principal: Principal) {
  const input = weeklyInputSchema.parse(raw), prior = state.batches.find(b => b.id === input.id)
  if (prior && repeated(prior.operations, input.idempotencyKey, input)) return prior
  if ((prior?.version ?? 0) !== input.version) conflict('La nómina cambió. Conservamos tu captura; recarga la versión actual.')
  if (prior?.status === 'paid' || prior?.historical) conflict('La nómina pagada o histórica es de solo lectura.')
  if (input.periodEnd < input.periodStart) conflict('La fecha final debe ser posterior o igual a la inicial.')
  if (new Set(input.lines.map(l => l.employeeId)).size !== input.lines.length) conflict('No puedes repetir un trabajador.')
  if (new Set([...input.lines, ...input.expenses].map(l => l.id)).size !== input.lines.length + input.expenses.length) conflict('Las partidas deben ser únicas.')
  const lines: WeeklyLine[] = input.lines.map(line => {
    const worker = [...workers, ...state.importedWorkers].find(w => w.id === line.employeeId && w.active)
    if (!worker) conflict('Selecciona un trabajador activo del directorio.')
    line.allocations.forEach(a => checkDestination(a, eventIds))
    const { calculation } = calculatePayroll({ employeeName: worker.name, periodStart: input.periodStart, periodEnd: input.periodEnd, baseCost: line.baseCost, additions: line.additions, deductions: line.deductions, allocations: line.allocations })
    return { ...line, ...calculation, employeeName: worker.name, periodStart: input.periodStart, periodEnd: input.periodEnd }
  })
  input.expenses.forEach(item => checkDestination(item, eventIds))
  const wages = lines.reduce((sum, l) => sum.plus(l.netPay), new Decimal(0)), extras = input.expenses.reduce((sum, e) => sum.plus(e.amount), new Decimal(0))
  const batch: WeeklyBatch = {
    id: input.id, version: input.version + 1, periodStart: input.periodStart, periodEnd: input.periodEnd, status: 'unpaid', lines,
    expenses: input.expenses.map(e => ({ ...e, amount: new Decimal(e.amount).toFixed(2) })), wagesTotal: wages.toFixed(2), expensesTotal: extras.toFixed(2), total: wages.plus(extras).toFixed(2),
    payments: prior?.payments ?? [], history: [...(prior?.history ?? []), audit(principal, prior ? 'Nómina actualizada' : 'Nómina creada', prior ? { lines: prior.lines, expenses: prior.expenses, periodStart: prior.periodStart, periodEnd: prior.periodEnd } : null, { lines, expenses: input.expenses, periodStart: input.periodStart, periodEnd: input.periodEnd })],
    operations: [...(prior?.operations ?? []), operation(input.idempotencyKey, input)],
  }
  state.batches = [...state.batches.filter(b => b.id !== batch.id), batch]
  return batch
}
export function payWeekly(state: WeeklyState, batchId: string, raw: unknown, principal: Principal) {
  const input = paymentInputSchema.parse(raw), batch = state.batches.find(b => b.id === batchId)
  if (!batch) conflict('La nómina no existe.')
  const request = { action: 'pay', ...input }
  if (repeated(batch.operations, input.idempotencyKey, request)) return batch
  if (batch.version !== input.version) conflict('La nómina cambió. Recarga antes de registrar el pago.')
  if (batch.status === 'paid' || batch.historical) conflict('Esta nómina no admite otro pago.')
  const payment: BatchPayment = { id: randomUUID(), paymentDate: input.paymentDate, amount: batch.total, actor: principal.userId, at: new Date().toISOString() }
  batch.payments.push(payment); batch.status = 'paid'; batch.version++
  batch.history.push(audit(principal, 'Pago completo registrado', { status: 'unpaid' }, payment))
  batch.operations.push(operation(input.idempotencyKey, request))
  return batch
}
export function reverseWeekly(state: WeeklyState, batchId: string, raw: unknown, principal: Principal) {
  const input = reversalInputSchema.parse(raw), batch = state.batches.find(b => b.id === batchId)
  if (!batch) conflict('La nómina no existe.')
  const request = { action: 'reverse', ...input }
  if (repeated(batch.operations, input.idempotencyKey, request)) return batch
  if (batch.version !== input.version) conflict('La nómina cambió. Recarga antes de revertir.')
  if (batch.status !== 'paid' || batch.historical) conflict('La nómina no tiene un pago que se pueda revertir.')
  const payment = batch.payments.findLast(p => !p.reversedAt)!
  const before = structuredClone(payment)
  payment.reversedAt = new Date().toISOString(); payment.reversalReason = input.reason
  batch.status = 'unpaid'; batch.version++
  batch.history.push(audit(principal, input.reason, before, { status: 'unpaid', payment }))
  batch.operations.push(operation(input.idempotencyKey, request))
  return batch
}
export function deleteWeekly(state: WeeklyState, batchId: string, raw: unknown, principal: Principal) {
  const input = deleteInputSchema.parse(raw), batch = state.batches.find(b => b.id === batchId)
  if (!batch) conflict('La nómina no existe.')
  if (batch.version !== input.version) conflict('La nómina cambió. Recarga antes de eliminarla.')
  if (batch.status === 'paid' || batch.historical) conflict('Revierte el pago antes de eliminar la nómina.')
  state.archive.push({ kind: 'deleted-weekly-payroll', batch: structuredClone(batch), deletedBy: principal.userId, deletedAt: new Date().toISOString() })
  state.batches = state.batches.filter(b => b.id !== batchId)
  return { id: batchId }
}
export function saveTeam(state: WeeklyState, raw: unknown, workers: WorkerRecord[]) {
  const input = teamInputSchema.parse(raw), prior = state.templates.find(t => t.id === input.id)
  if (prior && repeated(prior.operations, input.idempotencyKey, input)) return prior
  if ((prior?.version ?? 0) !== input.version) conflict('La plantilla cambió. Recarga antes de guardar.')
  if (new Set(input.lines.map(l => l.employeeId)).size !== input.lines.length) conflict('La plantilla tiene trabajadores repetidos.')
  for (const line of input.lines) {
    if (![...workers, ...state.importedWorkers].some(w => w.id === line.employeeId && w.active)) conflict('Trabajador no disponible.')
    if (new Decimal(line.baseCost).plus(line.additions).lt(line.deductions)) conflict('Deducciones inválidas.')
  }
  if (input.isDefault) state.templates.forEach(t => { if (t.isDefault && t.id !== input.id) { t.isDefault = false; t.version++ } })
  const { idempotencyKey, ...values } = input
  const result: TeamTemplate = { ...values, version: input.version + 1, operations: [...(prior?.operations ?? []), operation(idempotencyKey, input)] }
  state.templates = [...state.templates.filter(t => t.id !== input.id), result]
  return result
}

// Read-only projections let existing finance and exports consume costs without duplicate writes.
export function payrollProjection(state: WeeklyState): PayrollRecord[] {
  return [...state.legacy.filter(l => !l.archivedDraft), ...state.batches.flatMap(b => b.lines.map(l => ({ ...l, paidAmount: b.status === 'paid' ? l.netPay : '0.00', outstandingAmount: b.status === 'paid' ? '0.00' : l.netPay })))]
}
export function expenseProjection(state: WeeklyState) {
  return state.batches.flatMap(b => b.expenses.map(e => ({ id: `payroll:${b.id}:${e.id}`, eventId: e.eventId ?? '', name: e.concept, category: 'Gastos de nómina', expenseDate: b.periodEnd, amount: e.amount, paidAmount: b.status === 'paid' ? e.amount : '0.00', notes: e.notes, version: b.version, source: 'payroll' as const, payrollId: b.id, scope: e.scope })))
}
