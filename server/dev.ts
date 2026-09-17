import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'
import { buildApp } from './app.js'
import { sessionAuthenticator } from './auth.js'
import type { BusinessUnit, CreateEvent, CreatePayment, CreateSettlement, EventRecord, Principal, Role } from './domain.js'
import type { EventRepository, ExpenseRecord, PaymentRecord, SettlementRecord } from './repository.js'
import { FinancialConflictError } from './repository.js'
import type {PayrollRecord,PayrollSettlement,PayrollStore,PayrollTemplate,WorkerRecord} from './payroll.js'
import type { LoginUser, SessionStore } from './sessions.js'

export class DevelopmentStore implements SessionStore, EventRepository, PayrollStore {
  users:LoginUser[]=[]
  sessions=new Map<string,{userId:string;expiresAt:Date;revoked:boolean}>()
  events:EventRecord[]=[]
  expenses=new Map<string,ExpenseRecord[]>()
  payments=new Map<string,PaymentRecord[]>()
  payroll:PayrollRecord[]=[]
  payrollSettlements:PayrollSettlement[]=[]
  workers:WorkerRecord[]=[]
  payrollTemplates:PayrollTemplate[]=[]
  async findUserByEmail(email:string){return this.users.find(user=>user.email===email)??null}
  async findOrCreateGoogleUser(email:string,displayName:string,role:Role,businessUnit:BusinessUnit|null){let user=await this.findUserByEmail(email);if(!user){user={id:randomUUID(),email,displayName,role,businessUnit,passwordHash:null,active:true};this.users.push(user)}return user}
  async createSession(userId:string,tokenHash:string,expiresAt:Date){this.sessions.set(tokenHash,{userId,expiresAt,revoked:false})}
  async findPrincipal(tokenHash:string,now:Date){const session=this.sessions.get(tokenHash),user=session&&this.users.find(item=>item.id===session.userId);if(!session||session.revoked||session.expiresAt<=now||!user?.active)return null;return {userId:user.id,email:user.email,displayName:user.displayName,role:user.role,unit:user.businessUnit}}
  async revokeSession(tokenHash:string){const session=this.sessions.get(tokenHash);if(session)session.revoked=true}
  async list(principal:Principal){return principal.role==='coordinator'?this.events.filter(event=>event.businessUnit===principal.unit):this.events}
  async findById(id:string,principal:Principal){return (await this.list(principal)).find(event=>event.id===id)??null}
  async create(input:CreateEvent,principal:Principal){const financial=principal.role==='coordinator'?{}:input as Record<string,unknown>;const now=new Date().toISOString();const event:EventRecord={id:randomUUID(),businessUnit:input.businessUnit,clientName:input.clientName,clientPhone:input.clientPhone??null,venue:input.venue,eventDate:input.eventDate,operationalStatus:input.operationalStatus,operationalNotes:input.operationalNotes??null,financialNotes:financial.financialNotes as string|null??null,agreedPrice:financial.agreedPrice as string|null??null,payrollBudget:financial.payrollBudget as string??'0.00',extraExpenseBudget:financial.extraExpenseBudget as string??'0.00',version:1,createdAt:now,updatedAt:now};this.events.push(event);return event}
  async updatePayrollBudget(id:string,payrollBudget:string){const event=this.events.find(item=>item.id===id);if(!event)return null;event.payrollBudget=payrollBudget;event.version++;event.updatedAt=new Date().toISOString();return event}
  async addExpense(eventId:string,input:Parameters<EventRepository['addExpense']>[1],principal:Principal){if(!await this.findById(eventId,principal))return null;const item={...input,id:randomUUID(),eventId,paidAmount:'0.00',version:1};const items=this.expenses.get(eventId)??[];items.push(item);this.expenses.set(eventId,items);return item}
  async listExpenses(eventId:string,principal:Principal){return await this.findById(eventId,principal)?this.expenses.get(eventId)??[]:null}
  async addPayment(eventId:string,input:CreatePayment,principal:Principal){if(!await this.findById(eventId,principal))return null;const items=this.payments.get(eventId)??[];const existing=items.find(item=>item.idempotencyKey===input.idempotencyKey);if(existing)return existing;const payment={...input,id:randomUUID(),eventId,createdAt:new Date().toISOString()};items.push(payment);this.payments.set(eventId,items);return payment}
  async listPayments(eventId:string,principal:Principal){return await this.findById(eventId,principal)?this.payments.get(eventId)??[]:null}
  async addSettlement(expenseId:string,input:CreateSettlement){const expense=[...this.expenses.values()].flat().find(item=>item.id===expenseId);if(!expense)return null;const prior=(expense as ExpenseRecord&{settlements?:SettlementRecord[]}).settlements??[];const existing=prior.find(item=>item.idempotencyKey===input.idempotencyKey);if(existing)return existing;const pending=Number(expense.amount)-Number(expense.paidAmount);if(Math.abs(Number(input.amount)-pending)>.005)throw new FinancialConflictError('El gasto debe pagarse por completo');expense.paidAmount=Number(expense.amount).toFixed(2);const item={...input,id:randomUUID(),expenseId,createdAt:new Date().toISOString(),paidAmount:expense.paidAmount};prior.push(item);(expense as ExpenseRecord&{settlements?:SettlementRecord[]}).settlements=prior;return item}
  async listSettlements(){return [...this.expenses.values()].flat().flatMap(expense=>((expense as ExpenseRecord&{settlements?:SettlementRecord[]}).settlements??[]))}
  async createPayroll(value:Parameters<PayrollStore['createPayroll']>[0]){const record={id:randomUUID(),employeeName:value.input.employeeName,periodStart:value.input.periodStart,periodEnd:value.input.periodEnd,...value.calculation,paidAmount:'0.00',outstandingAmount:value.calculation.netPay,allocations:value.input.allocations};this.payroll.push(record);return record}
  async listPayroll(){return this.payroll}
  async settlePayroll(id:string,input:{paymentDate:string;amount:string;idempotencyKey:string}){const record=this.payroll.find(item=>item.id===id);if(!record)return null;const prior=this.payrollSettlements.find(item=>item.payrollEntryId===id&&item.idempotencyKey===input.idempotencyKey);if(prior)return prior;const paid=Number(record.paidAmount)+Number(input.amount);if(paid>Number(record.netPay))throw Object.assign(new Error('El pago excede el saldo pendiente'),{statusCode:409});record.paidAmount=paid.toFixed(2);record.outstandingAmount=(Number(record.netPay)-paid).toFixed(2);const settlement={id:randomUUID(),payrollEntryId:id,...input,createdAt:new Date().toISOString(),paidAmount:record.paidAmount,outstandingAmount:record.outstandingAmount};this.payrollSettlements.push(settlement);return settlement}
  async listPayrollSettlements(){return this.payrollSettlements}
  async listWorkers(){return this.workers.filter(worker=>worker.active).sort((a,b)=>a.name.localeCompare(b.name))}
  async createWorker(input:{name:string}){const worker={id:randomUUID(),name:input.name,active:true};this.workers.push(worker);return worker}
  async listTemplates(){return this.payrollTemplates}
  async createTemplate(input:Omit<PayrollTemplate,'id'>){const template={id:randomUUID(),...input};this.payrollTemplates.push(template);return template}
  async updateTemplate(id:string,input:Omit<PayrollTemplate,'id'>){const index=this.payrollTemplates.findIndex(template=>template.id===id);if(index<0)return null;const template={id,...input};this.payrollTemplates[index]=template;return template}
}

export async function startDevelopmentServer(){process.env.SPL_ALLOW_TEST_LOGIN??='1';process.env.ADMIN_EMAIL??='omendivilg@gmail.com';const clientId=process.env.GOOGLE_CLIENT_ID;if(!clientId)throw new Error('GOOGLE_CLIENT_ID is required');const googleClient=new OAuth2Client(clientId);const verifyGoogle=async(credential:string)=>{const ticket=await googleClient.verifyIdToken({idToken:credential,audience:clientId});const payload=ticket.getPayload();return payload?.email&&payload.name?{email:payload.email,name:payload.name,emailVerified:payload.email_verified===true}:null};const store=new DevelopmentStore();const app=buildApp(store,sessionAuthenticator(store),store,verifyGoogle,store);const port=Number(process.env.PORT??3001);await app.listen({host:'127.0.0.1',port});console.log(`Backend local listo en http://127.0.0.1:${port}`);return app}
