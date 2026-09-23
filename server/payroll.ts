import {Decimal} from 'decimal.js'
import {z} from 'zod'
import type {Pool} from 'pg'
import type {Principal} from './domain.js'

const amount=z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/,'Monto inválido')
const positive=amount.refine(value=>new Decimal(value).greaterThan(0),'El monto debe ser mayor que cero')
const allocation=z.object({scope:z.enum(['event','warehouse']),eventId:z.uuid().nullable().optional(),amount:positive}).strict().superRefine((value,ctx)=>{if(value.scope==='event'&&!value.eventId)ctx.addIssue({code:'custom',path:['eventId'],message:'El evento es obligatorio'});if(value.scope==='warehouse'&&value.eventId)ctx.addIssue({code:'custom',path:['eventId'],message:'Almacén no acepta evento'})})

const payrollInputSchema=z.object({employeeName:z.string().trim().min(1).max(160),periodStart:z.iso.date(),periodEnd:z.iso.date(),baseCost:amount,additions:amount.default('0.00'),deductions:amount.default('0.00'),allocations:z.array(allocation).min(1).max(100)}).strict().superRefine((value,ctx)=>{if(value.periodEnd<value.periodStart)ctx.addIssue({code:'custom',path:['periodEnd'],message:'El periodo es inválido'})})
export type PayrollInput=z.infer<typeof payrollInputSchema>
export type PayrollCalculation={baseCost:string;additions:string;deductions:string;laborCost:string;netPay:string;allocationTotal:string}

export function calculatePayroll(raw:unknown):{input:PayrollInput;calculation:PayrollCalculation}{const input=payrollInputSchema.parse(raw);const base=new Decimal(input.baseCost),additions=new Decimal(input.additions),deductions=new Decimal(input.deductions);const laborCost=base.plus(additions),netPay=laborCost.minus(deductions);if(netPay.isNegative())throw new z.ZodError([{code:'custom',path:['deductions'],message:'Las deducciones exceden el pago',input:input.deductions}]);const allocationTotal=input.allocations.reduce((sum,item)=>sum.plus(item.amount),new Decimal(0));if(!allocationTotal.equals(laborCost))throw new z.ZodError([{code:'custom',path:['allocations'],message:'Las asignaciones deben igualar el costo laboral',input:input.allocations}]);const fixed=(value:Decimal)=>value.toFixed(2);return{input,calculation:{baseCost:fixed(base),additions:fixed(additions),deductions:fixed(deductions),laborCost:fixed(laborCost),netPay:fixed(netPay),allocationTotal:fixed(allocationTotal)}}}

export type PayrollRecord=PayrollCalculation&{id:string;employeeName:string;periodStart:string;periodEnd:string;paidAmount:string;outstandingAmount:string;allocations:PayrollInput['allocations']}
export type PayrollSettlement={id:string;payrollEntryId:string;paymentDate:string;amount:string;idempotencyKey:string;createdAt:string;paidAmount:string;outstandingAmount:string}
export const workerInputSchema=z.object({name:z.string().trim().min(1).max(160)}).strict()
const templateInputSchema=z.object({name:z.string().trim().min(1).max(120),employeeId:z.uuid().nullable().optional(),baseCost:amount,additions:amount,deductions:amount,allocations:z.array(allocation).min(1).max(100)}).strict()
export type WorkerRecord={id:string;name:string;active:boolean}
export type PayrollTemplate=z.infer<typeof templateInputSchema>&{id:string}
export interface PayrollStore{listPayroll():Promise<PayrollRecord[]>;listPayrollSettlements():Promise<PayrollSettlement[]>;listWorkers():Promise<WorkerRecord[]>;createWorker(input:z.infer<typeof workerInputSchema>,principal:Principal):Promise<WorkerRecord>;listTemplates():Promise<PayrollTemplate[]>}
export class PostgresPayrollStore implements PayrollStore{
  private readonly pool: Pool
  constructor(pool:Pool){this.pool=pool}
  async listPayroll(){const entries=await this.pool.query<Omit<PayrollRecord,'allocations'>>('SELECT id,employee_name AS "employeeName",period_start AS "periodStart",period_end AS "periodEnd",base_cost AS "baseCost",additions,deductions,labor_cost AS "laborCost",net_pay AS "netPay",labor_cost AS "allocationTotal",paid_amount AS "paidAmount",net_pay-paid_amount AS "outstandingAmount" FROM payroll_entries ORDER BY period_end DESC,employee_name,id');const allocations=await this.pool.query<{payrollEntryId:string;scope:'event'|'warehouse';eventId:string|null;amount:string}>('SELECT payroll_entry_id AS "payrollEntryId",allocation_scope AS scope,event_id AS "eventId",amount FROM payroll_allocations ORDER BY id');return entries.rows.map(entry=>({...entry,allocations:allocations.rows.filter(item=>item.payrollEntryId===entry.id).map(({scope,eventId,amount})=>({scope,eventId,amount}))}))}
  async listPayrollSettlements(){const result=await this.pool.query<PayrollSettlement>('SELECT s.id,s.payroll_entry_id AS "payrollEntryId",s.payment_date AS "paymentDate",s.amount,s.idempotency_key AS "idempotencyKey",s.created_at AS "createdAt",p.paid_amount AS "paidAmount",p.net_pay-p.paid_amount AS "outstandingAmount" FROM payroll_settlements s JOIN payroll_entries p ON p.id=s.payroll_entry_id ORDER BY s.payment_date,s.created_at,s.id');return result.rows}
  async listWorkers(){return (await this.pool.query<WorkerRecord>('SELECT id,name,active FROM workers WHERE active=true ORDER BY name,id')).rows}
  async createWorker(input:z.infer<typeof workerInputSchema>,principal:Principal){return (await this.pool.query<WorkerRecord>('INSERT INTO workers (name,created_by) VALUES ($1,$2) RETURNING id,name,active',[input.name,principal.userId])).rows[0]}
  async listTemplates(){const rows=(await this.pool.query<{id:string;name:string;employeeId:string|null;baseCost:string;additions:string;deductions:string;allocations:unknown}>('SELECT id,name,employee_id AS "employeeId",base_cost AS "baseCost",additions,deductions,allocations FROM payroll_templates ORDER BY name,id')).rows;return rows.map(row=>({...row,allocations:templateInputSchema.shape.allocations.parse(row.allocations)}))}
}
