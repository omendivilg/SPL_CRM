import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import { OAuth2Client } from 'google-auth-library'
import { buildApp } from './app.js'
import { sessionAuthenticator } from './auth.js'
import type { BusinessUnit, CreateEvent, CreatePayment, CreateSettlement, EventRecord, Principal, Role } from './domain.js'
import type { EventRepository, ExpenseRecord, PaymentRecord, SettlementRecord } from './repository.js'
import { FinancialConflictError } from './repository.js'
import type {PayrollRecord,PayrollSettlement,PayrollStore,PayrollTemplate,WorkerRecord} from './payroll.js'
import { emptyWeekly, type WeeklyState, type WeeklyStore } from './weekly.js'
import type { LoginUser, SessionStore } from './sessions.js'

export class DevelopmentStore implements SessionStore, EventRepository, PayrollStore, WeeklyStore {
  users:LoginUser[]=[]
  sessions=new Map<string,{userId:string;expiresAt:Date;revoked:boolean}>()
  events:EventRecord[]=[]
  expenses=new Map<string,ExpenseRecord[]>()
  payments=new Map<string,PaymentRecord[]>()
  payroll:PayrollRecord[]=[]
  payrollSettlements:PayrollSettlement[]=[]
  workers:WorkerRecord[]=[]
  payrollTemplates:PayrollTemplate[]=[]
  weekly: WeeklyState = emptyWeekly()
  private weeklyQueue = Promise.resolve()
  private eventPaymentQueue = Promise.resolve()
  async findUserByEmail(email:string){return this.users.find(user=>user.email===email)??null}
  async findOrCreateGoogleUser(email:string,displayName:string,role:Role,businessUnit:BusinessUnit|null){let user=await this.findUserByEmail(email);if(!user){user={id:randomUUID(),email,displayName,role,businessUnit,passwordHash:null,active:true};this.users.push(user)}else{user.displayName=displayName;user.role=role;user.businessUnit=businessUnit}return user}
  async createSession(userId:string,tokenHash:string,expiresAt:Date){this.sessions.set(tokenHash,{userId,expiresAt,revoked:false})}
  async findPrincipal(tokenHash:string,now:Date){const session=this.sessions.get(tokenHash),user=session&&this.users.find(item=>item.id===session.userId);if(!session||session.revoked||session.expiresAt<=now||!user?.active)return null;return {userId:user.id,email:user.email,displayName:user.displayName,role:user.role,unit:user.businessUnit}}
  async revokeSession(tokenHash:string){const session=this.sessions.get(tokenHash);if(session)session.revoked=true}
  async list(principal:Principal){return this.events.filter(event=>!(event as EventRecord&{deletedAt?:string}).deletedAt&&(principal.role!=='coordinator'||event.businessUnit===principal.unit))}
  async findById(id:string,principal:Principal){return (await this.list(principal)).find(event=>event.id===id)??null}
  async create(input:CreateEvent,principal:Principal){const financial=principal.role==='coordinator'?{}:input as Record<string,unknown>;const now=new Date().toISOString();const event:EventRecord={id:randomUUID(),businessUnit:input.businessUnit,clientName:input.clientName,clientPhone:input.clientPhone??null,venue:input.venue,eventDate:input.eventDate,operationalStatus:input.operationalStatus,operationalNotes:input.operationalNotes??null,financialNotes:financial.financialNotes as string|null??null,agreedPrice:financial.agreedPrice as string|null??null,payrollBudget:financial.payrollBudget as string??'0.00',extraExpenseBudget:financial.extraExpenseBudget as string??'0.00',version:1,createdAt:now,updatedAt:now};this.events.push(event);return event}
  async updatePayrollBudget(id:string,payrollBudget:string){const event=this.events.find(item=>item.id===id&&!(item as EventRecord&{deletedAt?:string}).deletedAt);if(!event)return null;event.payrollBudget=payrollBudget;event.version++;event.updatedAt=new Date().toISOString();return event}
  async updateAgreedPrice(id:string,input:{agreedPrice:string|null;version:number}){const event=this.events.find(item=>item.id===id&&!(item as EventRecord&{deletedAt?:string}).deletedAt);if(!event)return null;if(event.version!==input.version)throw new FinancialConflictError('Evento desactualizado');event.agreedPrice=input.agreedPrice;event.version++;event.updatedAt=new Date().toISOString();return event}
  async deleteEvent(id:string,version:number){const event=this.events.find(item=>item.id===id&&!(item as EventRecord&{deletedAt?:string}).deletedAt);if(!event)return false;if(event.version!==version)throw new FinancialConflictError('El evento cambió. Recarga antes de eliminarlo.');(event as EventRecord&{deletedAt?:string}).deletedAt=new Date().toISOString();event.version++;return true}
  async addExpense(eventId:string,input:Parameters<EventRepository['addExpense']>[1],principal:Principal){if(!await this.findById(eventId,principal))return null;const item={...input,id:randomUUID(),eventId,paidAmount:'0.00',version:1};const items=this.expenses.get(eventId)??[];items.push(item);this.expenses.set(eventId,items);return item}
  async listExpenses(eventId:string,principal:Principal){return await this.findById(eventId,principal)?this.expenses.get(eventId)??[]:null}
  async addPayment(eventId:string,input:CreatePayment,principal:Principal){if(!await this.findById(eventId,principal))return null;const items=this.payments.get(eventId)??[];const existing=items.find(item=>item.idempotencyKey===input.idempotencyKey);if(existing)return existing;const payment={...input,id:randomUUID(),eventId,createdAt:new Date().toISOString(),version:1};items.push(payment);this.payments.set(eventId,items);return payment}
  async correctPayment(id:string,input:{amount:string;transactionDate:string;reason:string;version:number}){const payment=[...this.payments.values()].flat().find(item=>item.id===id&&!(item as PaymentRecord&{deletedAt?:string}).deletedAt);if(!payment)return null;if(payment.version!==input.version)throw new FinancialConflictError('Movimiento desactualizado');payment.amount=input.amount;payment.transactionDate=input.transactionDate;payment.version++;return payment}
  async listPayments(eventId:string,principal:Principal){return await this.findById(eventId,principal)?(this.payments.get(eventId)??[]).filter(item=>!(item as PaymentRecord&{deletedAt?:string}).deletedAt):null}
  async deletePayment(id:string,version:number){const payment=[...this.payments.values()].flat().find(item=>item.id===id&&!(item as PaymentRecord&{deletedAt?:string}).deletedAt);if(!payment)return false;if(payment.version!==version)throw new FinancialConflictError('El abono cambió. Recarga antes de quitarlo.');(payment as PaymentRecord&{deletedAt?:string}).deletedAt=new Date().toISOString();payment.version++;return true}
  async payRemaining(eventId:string,input:{transactionDate:string;idempotencyKey:string},principal:Principal){const task=this.eventPaymentQueue.then(async()=>{const event=await this.findById(eventId,principal);if(!event)return null;const items=this.payments.get(eventId)??[];const prior=items.find(item=>item.idempotencyKey===input.idempotencyKey);if(prior)return prior;if(event.agreedPrice===null)throw new FinancialConflictError('Define el precio acordado antes de registrar el pago.');const paid=items.filter(item=>!(item as PaymentRecord&{deletedAt?:string}).deletedAt).reduce((sum,item)=>sum.plus(item.kind==='refund'?new Decimal(item.amount).neg():item.amount),new Decimal(0));const remaining=new Decimal(event.agreedPrice).minus(paid);if(remaining.lte(0))throw new FinancialConflictError('Este evento ya no tiene saldo por cobrar.');return this.addPayment(eventId,{...input,amount:remaining.toFixed(2),kind:'payment'},principal)});this.eventPaymentQueue=task.then(()=>undefined,()=>undefined);return task}
  async addSettlement(expenseId:string,input:CreateSettlement){const expense=[...this.expenses.values()].flat().find(item=>item.id===expenseId);if(!expense)return null;const prior=(expense as ExpenseRecord&{settlements?:SettlementRecord[]}).settlements??[];const existing=prior.find(item=>item.idempotencyKey===input.idempotencyKey);if(existing)return existing;const pending=Number(expense.amount)-Number(expense.paidAmount);if(Math.abs(Number(input.amount)-pending)>.005)throw new FinancialConflictError('El gasto debe pagarse por completo');expense.paidAmount=Number(expense.amount).toFixed(2);const item={...input,id:randomUUID(),expenseId,createdAt:new Date().toISOString(),paidAmount:expense.paidAmount};prior.push(item);(expense as ExpenseRecord&{settlements?:SettlementRecord[]}).settlements=prior;return item}
  async listSettlements(){return [...this.expenses.values()].flat().flatMap(expense=>((expense as ExpenseRecord&{settlements?:SettlementRecord[]}).settlements??[]))}
  async listPayroll(){return this.payroll}
  async listPayrollSettlements(){return this.payrollSettlements}
  async listWorkers(){return this.workers.filter(worker=>worker.active).sort((a,b)=>a.name.localeCompare(b.name))}
  async createWorker(input:{name:string}){const worker={id:randomUUID(),name:input.name,active:true};this.workers.push(worker);return worker}
  async listTemplates(){return this.payrollTemplates}
  async readWeekly(){return structuredClone(this.weekly)}
  protected async commitWeekly(next: WeeklyState) { this.weekly = next }
  async transactWeekly<T>(operation:(state:WeeklyState)=>T|Promise<T>) {
    const task = this.weeklyQueue.then(async () => {
      const next = structuredClone(this.weekly)
      const result = await operation(next)
      await this.commitWeekly(next)
      return structuredClone(result)
    })
    this.weeklyQueue = task.then(() => undefined, () => undefined)
    return task
  }

}

export async function startDevelopmentServer(){process.env.SPL_ALLOW_TEST_LOGIN??='1';process.env.ADMIN_EMAIL??='omendivilg@gmail.com';const clientId=process.env.GOOGLE_CLIENT_ID;if(!clientId)throw new Error('GOOGLE_CLIENT_ID is required');const googleClient=new OAuth2Client(clientId);const verifyGoogle=async(credential:string)=>{const ticket=await googleClient.verifyIdToken({idToken:credential,audience:clientId});const payload=ticket.getPayload();return payload?.email&&payload.name?{email:payload.email,name:payload.name,emailVerified:payload.email_verified===true}:null};const store=new DevelopmentStore();const app=buildApp(store,sessionAuthenticator(store),store,verifyGoogle,store,store);const port=Number(process.env.PORT??3001);await app.listen({host:'127.0.0.1',port});console.log(`Backend local listo en http://127.0.0.1:${port}`);return app}
