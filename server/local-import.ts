import type { PoolClient } from 'pg'
import type { DevelopmentStore } from './dev.js'
import type { ExpenseRecord, PaymentRecord, SettlementRecord } from './repository.js'

type DeletedRecord = { deletedAt?: string | null }
export type LocalImportState = {
  users: DevelopmentStore['users']
  events: Array<DevelopmentStore['events'][number] & DeletedRecord>
  expenses: Array<[string, Array<ExpenseRecord & { settlements?: SettlementRecord[] }>]>
  payments: Array<[string, Array<PaymentRecord & DeletedRecord>]>
  payroll: DevelopmentStore['payroll']
  payrollSettlements: DevelopmentStore['payrollSettlements']
  workers: DevelopmentStore['workers']
  payrollTemplates: DevelopmentStore['payrollTemplates']
  weekly?: DevelopmentStore['weekly']
}

export function parseLocalImportState(value: unknown): LocalImportState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid local data: expected a snapshot object')
  const state = value as Record<string, unknown>
  for (const key of ['users', 'events', 'expenses', 'payments', 'payroll', 'payrollSettlements', 'workers', 'payrollTemplates']) {
    if (!Array.isArray(state[key])) throw new Error(`Invalid local data: ${key}`)
  }
  return state as LocalImportState
}

// The caller owns the connection and the immutable source-file backup.
// Retain soft-deleted history and references; repository reads hide deleted_at rows.
export async function importLocalSnapshot(client: Pick<PoolClient, 'query'>, state: LocalImportState, hash: string, sourceName: string) {
  const q = (text: string, values: unknown[] = []) => client.query(text, values)
  const actor = state.users[0]?.id ?? 'local-import'
  try {
    await q('BEGIN')
    if ((await q('SELECT 1 FROM data_imports WHERE source_hash=$1', [hash])).rowCount) {
      await q('ROLLBACK')
      return { alreadyImported: true as const }
    }
    const occupied = await q('SELECT (SELECT count(*) FROM events)+(SELECT count(*) FROM payroll_entries)+(SELECT count(*) FROM workers) AS count')
    if (Number(occupied.rows[0].count) > 0) throw new Error('Destination contains business data; import into an empty migrated database')
    for(const u of state.users)await q('INSERT INTO users(id,email,display_name,password_hash,role,business_unit,active) VALUES($1,$2,$3,$4,$5,$6,$7)',[u.id,u.email,u.displayName,u.passwordHash,u.role,u.businessUnit,u.active])
    for(const e of state.events)await q('INSERT INTO events(id,business_unit,client_name,client_phone,venue,event_date,operational_status,operational_notes,financial_notes,agreed_price,payroll_budget,extra_expense_budget,version,created_by,created_at,updated_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',[e.id,e.businessUnit,e.clientName,e.clientPhone,e.venue,e.eventDate,e.operationalStatus,e.operationalNotes,e.financialNotes,e.agreedPrice,e.payrollBudget,e.extraExpenseBudget,e.version,actor,e.createdAt??new Date(),e.updatedAt??new Date(),e.deletedAt??null])
    for(const [eventId,items] of state.expenses)for(const e of items){await q('INSERT INTO expenses(id,event_id,scope,name,category,expense_date,amount,paid_amount,supplier,notes,due_date,version,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[e.id,eventId,'event',e.name,e.category,e.expenseDate,e.amount,e.paidAmount,e.supplier,e.notes,e.dueDate,e.version??1,actor]);for(const s of e.settlements??[])await q('INSERT INTO expense_settlements(id,expense_id,payment_date,amount,idempotency_key,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[s.id,e.id,s.paymentDate,s.amount,s.idempotencyKey,actor,s.createdAt])}
    for(const [eventId,items] of state.payments)for(const p of items)await q('INSERT INTO customer_payments(id,event_id,transaction_date,amount,kind,idempotency_key,created_by,created_at,version,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[p.id,eventId,p.transactionDate,p.amount,p.kind,p.idempotencyKey,actor,p.createdAt,p.version??1,p.deletedAt??null])
    for(const p of state.payroll){await q('INSERT INTO payroll_entries(id,employee_name,period_start,period_end,base_cost,additions,deductions,labor_cost,net_pay,paid_amount,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[p.id,p.employeeName,p.periodStart,p.periodEnd,p.baseCost,p.additions,p.deductions,p.laborCost,p.netPay,p.paidAmount,actor]);for(const a of p.allocations)await q('INSERT INTO payroll_allocations(payroll_entry_id,event_id,allocation_scope,amount) VALUES($1,$2,$3,$4)',[p.id,a.eventId??null,a.scope,a.amount])}
    for(const s of state.payrollSettlements)await q('INSERT INTO payroll_settlements(id,payroll_entry_id,payment_date,amount,idempotency_key,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[s.id,s.payrollEntryId,s.paymentDate,s.amount,s.idempotencyKey,actor,s.createdAt])
    for(const w of state.workers)await q('INSERT INTO workers(id,name,active,created_by) VALUES($1,$2,$3,$4)',[w.id,w.name,w.active,actor])
    for(const t of state.payrollTemplates)await q('INSERT INTO payroll_templates(id,name,employee_id,base_cost,additions,deductions,allocations,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',[t.id,t.name,t.employeeId??null,t.baseCost,t.additions,t.deductions,JSON.stringify(t.allocations),actor])
    if(state.weekly)await q("INSERT INTO weekly_payroll_state(id,state) VALUES(true,$1::jsonb) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()",[JSON.stringify(state.weekly)])
    const counts={users:state.users.length,events:state.events.length,activeEvents:state.events.filter(event=>!event.deletedAt).length,deletedEvents:state.events.filter(event=>event.deletedAt).length,expenses:state.expenses.reduce((n,x)=>n+x[1].length,0),payments:state.payments.reduce((n,x)=>n+x[1].length,0),activePayments:state.payments.reduce((n,[eventId,items])=>n+(state.events.some(event=>event.id===eventId&&!event.deletedAt)?items.filter(payment=>!payment.deletedAt).length:0),0),deletedPayments:state.payments.reduce((n,[,items])=>n+items.filter(payment=>payment.deletedAt).length,0),payroll:state.payroll.length,weeklyBatches:state.weekly?.batches?.length??0,workers:state.workers.length,templates:state.payrollTemplates.length}
    await q('INSERT INTO data_imports(source_hash,source_name,counts) VALUES($1,$2,$3::jsonb)',[hash,sourceName,JSON.stringify(counts)])
    await q('COMMIT')
    return { alreadyImported: false as const, counts }
  } catch (error) {
    await q('ROLLBACK').catch(() => undefined)
    throw error
  }
}
