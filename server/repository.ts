import type { Pool, PoolClient } from 'pg'
import { Decimal } from 'decimal.js'
import type { BusinessUnit, CreateEvent, CreateExpense, CreatePayment, CreateSettlement, EventRecord, Principal } from './domain.js'

export type ExpenseRecord = CreateExpense & { id: string; eventId: string; paidAmount: string; version: number }
export type PaymentRecord = CreatePayment & { id:string;eventId:string;createdAt:string;version?:number }
export type SettlementRecord = CreateSettlement & { id:string;expenseId:string;createdAt:string;paidAmount:string }
export class FinancialConflictError extends Error { statusCode=409 }
export interface EventRepository {
  list(principal: Principal): Promise<EventRecord[]>
  findById(id: string, principal: Principal): Promise<EventRecord | null>
  create(input: CreateEvent, principal: Principal): Promise<EventRecord>
  updatePayrollBudget(id:string,payrollBudget:string,principal:Principal):Promise<EventRecord|null>
  updateAgreedPrice?(id:string,input:{agreedPrice:string|null;version:number},principal:Principal):Promise<EventRecord|null>
  deleteEvent?(id:string,version:number,principal:Principal):Promise<boolean>
  addExpense(eventId: string, input: CreateExpense, principal: Principal): Promise<ExpenseRecord | null>
  listExpenses(eventId: string, principal: Principal): Promise<ExpenseRecord[] | null>
  addPayment(eventId:string,input:CreatePayment,principal:Principal):Promise<PaymentRecord|null>
  correctPayment?(id:string,input:{amount:string;transactionDate:string;reason:string;version:number},principal:Principal):Promise<PaymentRecord|null>
  deletePayment?(id:string,version:number,principal:Principal):Promise<boolean>
  payRemaining?(eventId:string,input:{transactionDate:string;idempotencyKey:string},principal:Principal):Promise<PaymentRecord|null>
  listPayments(eventId:string,principal:Principal):Promise<PaymentRecord[]|null>
  addSettlement(expenseId:string,input:CreateSettlement,principal:Principal):Promise<SettlementRecord|null>
  listSettlements(principal:Principal):Promise<SettlementRecord[]>
}

type EventRow = {
  id: string; business_unit: BusinessUnit; client_name: string; client_phone: string | null; venue: string;
  event_date: string | Date; operational_status: EventRecord['operationalStatus']; operational_notes: string | null;
  financial_notes: string | null; agreed_price: string | null; payroll_budget: string; extra_expense_budget: string;
  version: number; created_at: string | Date; updated_at: string | Date
}
const isoDate = (value: string | Date) => typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)
const isoTime = (value: string | Date) => typeof value === 'string' ? new Date(value).toISOString() : value.toISOString()
function mapEvent(row: EventRow): EventRecord { return { id:row.id,businessUnit:row.business_unit,clientName:row.client_name,clientPhone:row.client_phone,venue:row.venue,eventDate:isoDate(row.event_date),operationalStatus:row.operational_status,operationalNotes:row.operational_notes,financialNotes:row.financial_notes,agreedPrice:row.agreed_price,payrollBudget:row.payroll_budget,extraExpenseBudget:row.extra_expense_budget,version:row.version,createdAt:isoTime(row.created_at),updatedAt:isoTime(row.updated_at) } }

const eventColumns = 'id, business_unit, client_name, client_phone, venue, event_date, operational_status, operational_notes, financial_notes, agreed_price, payroll_budget, extra_expense_budget, version, created_at, updated_at'

export class PostgresEventRepository implements EventRepository {
  constructor(private readonly pool: Pool) {}
  async list(principal: Principal) {
    const scoped = principal.role === 'coordinator'
    const result = await this.pool.query<EventRow>(`SELECT ${eventColumns} FROM events WHERE deleted_at IS NULL ${scoped ? 'AND business_unit = $1' : ''} ORDER BY event_date, id`, scoped ? [principal.unit] : [])
    return result.rows.map(mapEvent)
  }
  async findById(id: string, principal: Principal) {
    const scoped = principal.role === 'coordinator'
    const result = await this.pool.query<EventRow>(`SELECT ${eventColumns} FROM events WHERE id = $1 AND deleted_at IS NULL ${scoped ? 'AND business_unit = $2' : ''}`, scoped ? [id, principal.unit] : [id])
    return result.rows[0] ? mapEvent(result.rows[0]) : null
  }
  async create(input: CreateEvent, principal: Principal) {
    const ownerInput = principal.role !== 'coordinator' ? input as Record<string, unknown> : {}
    const values = [input.businessUnit,input.clientName,input.clientPhone ?? null,input.venue,input.eventDate,input.operationalStatus,input.operationalNotes ?? null,ownerInput.financialNotes ?? null,ownerInput.agreedPrice ?? null,ownerInput.payrollBudget ?? '0.00',ownerInput.extraExpenseBudget ?? '0.00',principal.userId]
    const result = await this.pool.query<EventRow>(`INSERT INTO events (business_unit, client_name, client_phone, venue, event_date, operational_status, operational_notes, financial_notes, agreed_price, payroll_budget, extra_expense_budget, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${eventColumns}`, values)
    return mapEvent(result.rows[0])
  }
  async updatePayrollBudget(id:string,payrollBudget:string,principal:Principal){const result=await this.pool.query<EventRow>(`UPDATE events SET payroll_budget=$1,version=version+1,updated_at=now() WHERE id=$2 AND deleted_at IS NULL RETURNING ${eventColumns}`,[payrollBudget,id]);return result.rows[0]?mapEvent(result.rows[0]):null}
  async updateAgreedPrice(id:string,input:{agreedPrice:string|null;version:number},principal:Principal){const result=await this.pool.query<EventRow>(`UPDATE events SET agreed_price=$1,version=version+1,updated_at=now() WHERE id=$2 AND version=$3 AND deleted_at IS NULL RETURNING ${eventColumns}`,[input.agreedPrice,id,input.version]);return result.rows[0]?mapEvent(result.rows[0]):null}
  async deleteEvent(id:string,version:number,principal:Principal){
    const client=await this.pool.connect()
    try { await client.query('BEGIN')
      const old=(await client.query<EventRow>(`SELECT ${eventColumns} FROM events WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,[id])).rows[0]
      if(!old){await client.query('ROLLBACK');return false}
      if(old.version!==version)throw new FinancialConflictError('El evento cambió. Recarga antes de eliminarlo.')
      const linked=await client.query('SELECT 1 FROM payroll_allocations WHERE event_id=$1 LIMIT 1',[id])
      if(linked.rows.length)throw new FinancialConflictError('El evento tiene costos de nómina históricos. No se puede eliminar.')
      await client.query('UPDATE events SET deleted_at=now(),version=version+1,updated_at=now() WHERE id=$1',[id])
      await client.query('INSERT INTO audit_log(actor_user_id,entity_type,entity_id,action,old_values) VALUES($1,$2,$3,$4,$5)',[principal.userId,'event',id,'delete',JSON.stringify(mapEvent(old))])
      await client.query('COMMIT');return true
    } catch(error){await client.query('ROLLBACK');throw error} finally{client.release()}
  }
  async addExpense(eventId: string, input: CreateExpense, principal: Principal) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const event = await client.query<{id:string}>('SELECT id FROM events WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [eventId])
      if (!event.rows[0]) { await client.query('ROLLBACK'); return null }
      const result = await client.query<ExpenseRecord>('INSERT INTO expenses (event_id, name, category, expense_date, amount, supplier, notes, due_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, event_id AS "eventId", name, category, expense_date AS "expenseDate", amount, supplier, notes, due_date AS "dueDate", paid_amount AS "paidAmount", version', [eventId,input.name,input.category,input.expenseDate,input.amount,input.supplier??null,input.notes??null,input.dueDate??null,principal.userId])
      await client.query('INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, new_values) VALUES ($1,$2,$3,$4,$5)', [principal.userId,'expense',result.rows[0].id,'create',JSON.stringify(input)])
      await client.query('COMMIT')
      return result.rows[0]
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  async listExpenses(eventId: string, principal: Principal) {
    const event = await this.findById(eventId, principal)
    if (!event) return null
    const result = await this.pool.query<ExpenseRecord>('SELECT id, event_id AS "eventId", name, category, expense_date AS "expenseDate", amount, supplier, notes, due_date AS "dueDate", paid_amount AS "paidAmount", version FROM expenses WHERE event_id = $1 ORDER BY expense_date, id', [eventId])
    return result.rows
  }
  async addPayment(eventId:string,input:CreatePayment,principal:Principal){const client=await this.pool.connect();try{await client.query('BEGIN');const event=await client.query('SELECT id FROM events WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',[eventId]);if(!event.rows[0]){await client.query('ROLLBACK');return null}const inserted=await client.query<PaymentRecord>('INSERT INTO customer_payments (event_id, transaction_date, amount, kind, idempotency_key, created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id, event_id AS "eventId", transaction_date AS "transactionDate", amount, kind, idempotency_key AS "idempotencyKey", created_at AS "createdAt", version',[eventId,input.transactionDate,input.amount,input.kind,input.idempotencyKey,principal.userId]);const result=inserted.rows[0]??(await client.query<PaymentRecord>('SELECT id, event_id AS "eventId", transaction_date AS "transactionDate", amount, kind, idempotency_key AS "idempotencyKey", created_at AS "createdAt", version FROM customer_payments WHERE idempotency_key = $1 AND event_id = $2',[input.idempotencyKey,eventId])).rows[0];if(!result)throw new Error('Idempotency key conflict');await client.query('COMMIT');return result}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}
  async correctPayment(id:string,input:{amount:string;transactionDate:string;reason:string;version:number},principal:Principal){const client=await this.pool.connect();try{await client.query('BEGIN');const old=(await client.query<PaymentRecord>('SELECT id,event_id AS "eventId",transaction_date AS "transactionDate",amount,kind,idempotency_key AS "idempotencyKey",created_at AS "createdAt",version FROM customer_payments WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows[0];if(!old){await client.query('ROLLBACK');return null}const updated=(await client.query<PaymentRecord>('UPDATE customer_payments SET amount=$1,transaction_date=$2,version=version+1 WHERE id=$3 AND version=$4 RETURNING id,event_id AS "eventId",transaction_date AS "transactionDate",amount,kind,idempotency_key AS "idempotencyKey",created_at AS "createdAt",version',[input.amount,input.transactionDate,id,input.version])).rows[0];if(!updated)throw new FinancialConflictError('Movimiento desactualizado');await client.query('INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,old_values,new_values) VALUES ($1,$2,$3,$4,$5,$6)',[principal.userId,'customer_payment',id,'correct',JSON.stringify(old),JSON.stringify({...updated,reason:input.reason})]);await client.query('COMMIT');return updated}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}
  async listPayments(eventId:string,principal:Principal){const event=await this.findById(eventId,principal);if(!event)return null;const result=await this.pool.query<PaymentRecord>('SELECT id, event_id AS "eventId", transaction_date AS "transactionDate", amount, kind, idempotency_key AS "idempotencyKey", created_at AS "createdAt", version FROM customer_payments WHERE event_id = $1 AND deleted_at IS NULL ORDER BY transaction_date, created_at, id',[eventId]);return result.rows}
  async deletePayment(id:string,version:number,principal:Principal){const client=await this.pool.connect();try{await client.query('BEGIN');const old=(await client.query<PaymentRecord>('SELECT id,event_id AS "eventId",transaction_date AS "transactionDate",amount,kind,idempotency_key AS "idempotencyKey",created_at AS "createdAt",version FROM customer_payments WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows[0];if(!old){await client.query('ROLLBACK');return false}if(old.version!==version)throw new FinancialConflictError('El abono cambió. Recarga antes de quitarlo.');await client.query('UPDATE customer_payments SET deleted_at=now(),version=version+1 WHERE id=$1',[id]);await client.query('INSERT INTO audit_log(actor_user_id,entity_type,entity_id,action,old_values) VALUES($1,$2,$3,$4,$5)',[principal.userId,'customer_payment',id,'delete',JSON.stringify(old)]);await client.query('COMMIT');return true}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}
  async payRemaining(eventId:string,input:{transactionDate:string;idempotencyKey:string},principal:Principal){const client=await this.pool.connect();try{await client.query('BEGIN');const event=(await client.query<{agreed_price:string|null}>('SELECT agreed_price FROM events WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[eventId])).rows[0];if(!event){await client.query('ROLLBACK');return null}const prior=(await client.query<PaymentRecord>('SELECT id,event_id AS "eventId",transaction_date AS "transactionDate",amount,kind,idempotency_key AS "idempotencyKey",created_at AS "createdAt",version FROM customer_payments WHERE idempotency_key=$1 AND event_id=$2',[input.idempotencyKey,eventId])).rows[0];if(prior){await client.query('COMMIT');return prior}if(event.agreed_price===null)throw new FinancialConflictError('Define el precio acordado antes de registrar el pago.');const total=(await client.query<{net:string}>('SELECT COALESCE(SUM(CASE WHEN kind=\'refund\' THEN -amount ELSE amount END),0)::text AS net FROM customer_payments WHERE event_id=$1 AND deleted_at IS NULL',[eventId])).rows[0].net;const remaining=new Decimal(event.agreed_price).minus(total);if(remaining.lte(0))throw new FinancialConflictError('Este evento ya no tiene saldo por cobrar.');const result=(await client.query<PaymentRecord>('INSERT INTO customer_payments(event_id,transaction_date,amount,kind,idempotency_key,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,event_id AS "eventId",transaction_date AS "transactionDate",amount,kind,idempotency_key AS "idempotencyKey",created_at AS "createdAt",version',[eventId,input.transactionDate,remaining.toFixed(2),'payment',input.idempotencyKey,principal.userId])).rows[0];await client.query('COMMIT');return result}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}
  async addSettlement(expenseId:string,input:CreateSettlement,principal:Principal){const client=await this.pool.connect();try{await client.query('BEGIN');const expense=await client.query<{id:string}>('SELECT id FROM expenses WHERE id = $1 FOR UPDATE',[expenseId]);if(!expense.rows[0]){await client.query('ROLLBACK');return null}const prior=await client.query<SettlementRecord>('SELECT s.id, s.expense_id AS "expenseId", s.payment_date AS "paymentDate", s.amount, s.idempotency_key AS "idempotencyKey", s.created_at AS "createdAt", e.paid_amount AS "paidAmount" FROM expense_settlements s JOIN expenses e ON e.id=s.expense_id WHERE s.idempotency_key=$1 AND s.expense_id=$2',[input.idempotencyKey,expenseId]);if(prior.rows[0]){await client.query('COMMIT');return prior.rows[0]}const updated=await client.query<{paidAmount:string}>('UPDATE expenses SET paid_amount=amount, updated_at=now(), version=version+1 WHERE id=$2 AND $1=amount-paid_amount RETURNING paid_amount AS "paidAmount"',[input.amount,expenseId]);if(!updated.rows[0])throw new FinancialConflictError('El gasto debe pagarse por completo');const result=await client.query<SettlementRecord>('INSERT INTO expense_settlements (expense_id,payment_date,amount,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id,expense_id AS "expenseId",payment_date AS "paymentDate",amount,idempotency_key AS "idempotencyKey",created_at AS "createdAt"',[expenseId,input.paymentDate,input.amount,input.idempotencyKey,principal.userId]);await client.query('COMMIT');return {...result.rows[0],paidAmount:updated.rows[0].paidAmount}}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}
  async listSettlements(){const result=await this.pool.query<SettlementRecord>('SELECT s.id,s.expense_id AS "expenseId",s.payment_date AS "paymentDate",s.amount,s.idempotency_key AS "idempotencyKey",s.created_at AS "createdAt",e.paid_amount AS "paidAmount" FROM expense_settlements s JOIN expenses e ON e.id=s.expense_id ORDER BY s.payment_date,s.created_at,s.id');return result.rows}
}
