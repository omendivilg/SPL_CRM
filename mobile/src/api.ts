import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'

export type User={userId:string;email:string;displayName:string;role:'admin'|'owner'|'coordinator';unit:'SPL'|'5to Elemento'|null}
export type EventRecord={id:string;version:number;clientName:string;venue:string;eventDate:string;businessUnit:'SPL'|'5to Elemento';agreedPrice?:string|null;payrollBudget?:string;extraExpenseBudget?:string;operationalStatus:string}
export type Payment={id:string;transactionDate:string;amount:string;kind:'payment'|'refund';version:number}
export type Expense={id:string;name:string;category:string;expenseDate:string;amount:string;paidAmount:string;notes?:string|null;paymentMethod?:'cash'|'card'|null;source?:'payroll'}
export type QuickExpense={id:string;name:string;category:string;expenseDate:string;amount:string;businessUnit:'SPL'|'5to Elemento';notes:string;paymentMethod:'cash'|'card'|null;createdBy:string;createdAt:string}
export type DirectIncome={id:string;name:string;amount:string;expectedDate:string;receivedDate:string|null;notes?:string|null;businessUnit:'SPL'|'5to Elemento';version:number;createdBy:string;createdAt:string;receivedBy?:string;receivedAt?:string;deletedAt?:string;deletedBy?:string}
export type Worker={id:string;name:string;active:boolean}
export type TeamTemplate={id:string;name:string;isDefault:boolean;businessUnit:'SPL'|'5to Elemento';lines:{employeeId:string;baseCost:string;additions:string;deductions:string}[];expenses:{concept:string;category:string;amount:string;notes:string}[]}
export type Payroll={id:string;version:number;name?:string;businessUnit:'SPL'|'5to Elemento';periodStart:string;periodEnd:string;status:'paid'|'unpaid';total:string;lines:{id:string;employeeName:string;netPay:string;laborCost:string}[];expenses:{id:string;concept:string;category:string;amount:string;notes?:string;scope:'event'|'warehouse';eventId?:string|null}[];payments:{id:string;paymentDate:string;amount:string;reversedAt?:string}[]}
export type ExpenseSettlement={id:string;expenseId:string;paymentDate:string;amount:string}
export type LegacyPayroll={entries:{id:string;employeeName:string;periodStart:string;periodEnd:string;laborCost:string;netPay:string;archivedDraft?:boolean;allocations:{scope:'event'|'warehouse';eventId?:string|null;amount:string}[]}[];settlements:{id:string;payrollEntryId:string;paymentDate:string;amount:string}[]}
const API=process.env.EXPO_PUBLIC_API_URL
const TOKEN='spl.session'
async function request<T>(path:string,options:RequestInit={}){
  if(!API)throw new Error('Falta EXPO_PUBLIC_API_URL')
  const token=await SecureStore.getItemAsync(TOKEN),response=await fetch(`${API}${path}`,{...options,headers:{accept:'application/json',...(options.body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})}})
  if(!response.ok){const body=await response.json().catch(()=>null) as {error?:string}|null;throw new Error(response.status===401?'Tu sesión venció.':response.status===409&&body?.error?body.error:'No se pudo conectar con SPL.')}
  if(response.status===204)return undefined as T
  return (await response.json()).data as T
}
export async function nativeGoogle(credential:string){const result=await request<{user:User;token:string}>('/api/auth/google/native',{method:'POST',body:JSON.stringify({credential})});await SecureStore.setItemAsync(TOKEN,result.token);return result.user}
export async function currentUser(){try{return await request<User>('/api/auth/me')}catch{return null}}
export async function logout(){try{await request('/api/auth/logout',{method:'POST'})}finally{await SecureStore.deleteItemAsync(TOKEN)}}
export const listEvents=()=>request<EventRecord[]>('/api/events')
export const createEvent=(input:Record<string,unknown>)=>request<EventRecord>('/api/events',{method:'POST',body:JSON.stringify(input)})
export const updatePrice=(event:EventRecord,agreedPrice:string|null)=>request<EventRecord>(`/api/events/${event.id}/price`,{method:'PATCH',body:JSON.stringify({agreedPrice,version:event.version})})
export const deleteEvent=(event:EventRecord)=>request<{id:string}>(`/api/events/${event.id}`,{method:'DELETE',body:JSON.stringify({version:event.version})})
export const listPayments=(id:string)=>request<Payment[]>(`/api/events/${id}/payments`)
export const addPayment=(id:string,kind:'payment'|'refund',amount:string,transactionDate:string)=>request<Payment>(`/api/events/${id}/payments`,{method:'POST',body:JSON.stringify({kind,amount,transactionDate,idempotencyKey:Crypto.randomUUID()})})
export const payRemaining=(id:string,transactionDate:string)=>request<Payment>(`/api/events/${id}/pay-remaining`,{method:'POST',body:JSON.stringify({transactionDate,idempotencyKey:Crypto.randomUUID()})})
export const deletePayment=(payment:Payment)=>request<{id:string}>(`/api/payments/${payment.id}`,{method:'DELETE',body:JSON.stringify({version:payment.version})})
export const listExpenses=(id:string)=>request<Expense[]>(`/api/events/${id}/expenses`)
export const addExpense=(id:string,input:{name:string;category:string;amount:string;expenseDate:string})=>request<Expense>(`/api/events/${id}/expenses`,{method:'POST',body:JSON.stringify(input)})
export const listQuickExpenses=()=>request<QuickExpense[]>('/api/quick-expenses')
export const addQuickExpense=(id:string,input:{name:string;category:string;amount:string;expenseDate:string;businessUnit:'SPL'|'5to Elemento';notes:string;paymentMethod:'cash'|'card'})=>request<QuickExpense>(`/api/quick-expenses/${id}`,{method:'PUT',body:JSON.stringify(input)})
export const listDirectIncome=()=>request<DirectIncome[]>('/api/direct-income')
export const createDirectIncome=(id:string,input:{name:string;amount:string;businessUnit:'SPL'|'5to Elemento';expectedDate:string;receivedDate:string|null;notes?:string|null})=>request<DirectIncome>(`/api/direct-income/${id}`,{method:'PUT',body:JSON.stringify(input)})
export const receiveDirectIncome=(income:DirectIncome,receivedDate:string)=>request<DirectIncome>(`/api/direct-income/${income.id}/receive`,{method:'PATCH',body:JSON.stringify({receivedDate,version:income.version})})
export const deleteDirectIncome=(income:DirectIncome)=>request<{id:string}>(`/api/direct-income/${income.id}`,{method:'DELETE',body:JSON.stringify({version:income.version})})
export const listPayroll=()=>request<Payroll[]>('/api/weekly-payroll')
export const listExpenseSettlements=()=>request<ExpenseSettlement[]>('/api/expense-settlements')
export const listLegacyPayroll=()=>request<LegacyPayroll>('/api/weekly-payroll/legacy')
export const listWorkers=()=>request<Worker[]>('/api/workers')
export const createWorker=(name:string)=>request<Worker>('/api/workers',{method:'POST',body:JSON.stringify({name})})
export const listTemplates=()=>request<TeamTemplate[]>('/api/team-templates')
export const savePayroll=(id:string,input:Record<string,unknown>)=>request<Payroll>(`/api/weekly-payroll/${id}`,{method:'PUT',body:JSON.stringify(input)})
export const payPayroll=(payroll:Payroll,paymentDate:string)=>request<Payroll>(`/api/weekly-payroll/${payroll.id}/pay`,{method:'POST',body:JSON.stringify({version:payroll.version,paymentDate,idempotencyKey:Crypto.randomUUID()})})
export const reversePayroll=(payroll:Payroll,reason:string)=>request<Payroll>(`/api/weekly-payroll/${payroll.id}/reverse`,{method:'POST',body:JSON.stringify({version:payroll.version,reason,idempotencyKey:Crypto.randomUUID()})})
export const deletePayroll=(payroll:Payroll)=>request<{id:string}>(`/api/weekly-payroll/${payroll.id}`,{method:'DELETE',body:JSON.stringify({version:payroll.version})})
