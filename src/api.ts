type ApiBusinessUnit = 'SPL' | '5to Elemento'
export type ApiEvent = {
  id: string
  businessUnit: ApiBusinessUnit
  clientName: string
  clientPhone: string | null
  venue: string
  eventDate: string
  operationalStatus: 'Pendiente' | 'Confirmado' | 'Completado' | 'Cancelado'
  operationalNotes: string | null
  financialNotes?: string | null
  agreedPrice?: string | null
  payrollBudget?: string
  extraExpenseBudget?: string
  version: number
}
export type ApiExpense = { id:string;eventId:string;name:string;category:string;expenseDate:string;amount:string;paidAmount:string;supplier?:string|null;notes?:string|null;dueDate?:string|null;version:number;source?:'payroll';payrollId?:string;businessUnit?:'SPL'|'5to Elemento' }
export type ApiQuickExpense = { id:string;name:string;category:string;expenseDate:string;amount:string;businessUnit:'SPL'|'5to Elemento';notes:string;paymentMethod:'cash'|'card'|null;createdAt:string;createdBy:string }
export type ApiDirectIncome = { id:string;name:string;amount:string;expectedDate:string;receivedDate:string|null;notes?:string|null;businessUnit:ApiBusinessUnit;version:number;createdBy:string;createdAt:string;receivedBy?:string;receivedAt?:string;deletedAt?:string;deletedBy?:string }
export type ApiPayment={id:string;eventId:string;transactionDate:string;amount:string;kind:'payment'|'refund';idempotencyKey:string;createdAt:string;version?:number}
export type ApiSettlement={id:string;expenseId:string;paymentDate:string;amount:string;idempotencyKey:string;createdAt:string;paidAmount:string}
export type ApiPayroll={id:string;employeeName:string;periodStart:string;periodEnd:string;baseCost:string;additions:string;deductions:string;laborCost:string;netPay:string;allocationTotal:string;paidAmount:string;outstandingAmount:string;allocations:Array<{scope:'event'|'warehouse';eventId?:string|null;amount:string}>}
export type ApiWorker={id:string;name:string;active:boolean}
export type ApiWeeklyPayroll = import('../server/weekly').WeeklyBatch
export type ApiTeamTemplate = import('../server/weekly').TeamTemplate
export type WeeklyPayrollInput = Omit<import('../server/weekly').WeeklyInput, 'id'>
export type LegacyPayroll = { entries: import('../server/weekly').LegacyEntry[]; settlements: import('../server/payroll').PayrollSettlement[] }
export type CreateEventInput = Omit<ApiEvent,'id'|'version'>
export type CreateExpenseInput = { name:string;category:string;expenseDate:string;amount:string;supplier?:string|null;notes?:string|null;dueDate?:string|null }
export type SessionUser={userId:string;email:string;displayName:string;role:'admin'|'owner'|'coordinator';unit:ApiBusinessUnit|null}
export class ApiError extends Error {
  readonly kind:'network'|'timeout'|'unauthorized'|'forbidden'|'invalid'|'server'
  readonly status?:number
  constructor(kind:'network'|'timeout'|'unauthorized'|'forbidden'|'invalid'|'server', status?:number) {
    super(kind === 'network' ? 'No pudimos conectar con el servidor.' : kind === 'timeout' ? 'El servidor tardó demasiado en responder.' : kind === 'unauthorized' ? 'Tu sesión ya no es válida.' : kind === 'forbidden' ? 'No tienes permiso para realizar esta acción.' : kind === 'invalid' ? 'El servidor rechazó la información.' : 'El servidor no pudo completar la solicitud.')
    this.kind=kind
    this.status=status
  }
}
const baseUrl = import.meta.env.VITE_API_URL ?? ''
const devToken = import.meta.env.DEV ? import.meta.env.VITE_DEV_API_TOKEN : undefined
async function request<T>(path:string, options:RequestInit={}, retryGet=true):Promise<T> {
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),8000)
  try {
    const response=await fetch(`${baseUrl}${path}`,{...options,credentials:'include',signal:controller.signal,headers:{accept:'application/json',...(options.body?{'content-type':'application/json'}:{}),...(devToken?{authorization:`Bearer ${devToken}`} : {}),...options.headers}})
    if (options.method !== 'POST' && retryGet && [502,503,504].includes(response.status)) { clearTimeout(timeout); return request<T>(path,options,false) }
    if (!response.ok) {
      const error = new ApiError(response.status===401?'unauthorized':response.status===403?'forbidden':response.status<500?'invalid':'server',response.status)
      if (response.status === 400 || response.status === 409) {
        const details = await response.json().catch(() => null)
        if (details?.issues?.length) error.message = details.issues.map((issue: {path:string;message:string}) => `${issue.path}: ${issue.message}`).join(' · ')
        else if (typeof details?.error === 'string') error.message = details.error
      }
      throw error
    }
    try { const body=await response.json() as {data:T}; if(!body||!('data' in body))throw new Error('shape'); return body.data }
    catch { throw new ApiError('server',response.status) }
  } catch(error) {
    if(error instanceof ApiError)throw error
    if(error instanceof DOMException&&error.name==='AbortError')throw new ApiError('timeout')
    throw new ApiError('network')
  } finally { clearTimeout(timeout) }
}
async function requestVoid(path:string,options:RequestInit){await fetch(`${baseUrl}${path}`,{...options,credentials:'include',headers:{accept:'application/json',...options.headers}})}
async function requestFile(path:string){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);try{const response=await fetch(`${baseUrl}${path}`,{credentials:'include',signal:controller.signal,headers:{...(devToken?{authorization:`Bearer ${devToken}`}:{})}});if(!response.ok)throw new ApiError(response.status===401?'unauthorized':response.status===403?'forbidden':response.status<500?'invalid':'server',response.status);return response.blob()}catch(error){if(error instanceof ApiError)throw error;if(error instanceof DOMException&&error.name==='AbortError')throw new ApiError('timeout');throw new ApiError('network')}finally{clearTimeout(timeout)}}
export const eventApi = {
  listExpenseSettlements:()=>request<ApiSettlement[]>('/api/expense-settlements'),
  list:()=>request<ApiEvent[]>('/api/events'),
  create:(input:CreateEventInput)=>request<ApiEvent>('/api/events',{method:'POST',body:JSON.stringify(input)},false),
  updateAgreedPrice:(eventId:string,input:{agreedPrice:string|null;version:number})=>request<ApiEvent>(`/api/events/${encodeURIComponent(eventId)}/price`,{method:'PATCH',body:JSON.stringify(input)},false),
  listExpenses:(eventId:string)=>request<ApiExpense[]>(`/api/events/${encodeURIComponent(eventId)}/expenses`),
  addExpense:(eventId:string,input:CreateExpenseInput)=>request<ApiExpense>(`/api/events/${encodeURIComponent(eventId)}/expenses`,{method:'POST',body:JSON.stringify(input)},false),
  listPayments:(eventId:string)=>request<ApiPayment[]>(`/api/events/${encodeURIComponent(eventId)}/payments`),
  addPayment:(eventId:string,input:{transactionDate:string;amount:string;kind:'payment'|'refund';idempotencyKey:string})=>request<ApiPayment>(`/api/events/${encodeURIComponent(eventId)}/payments`,{method:'POST',body:JSON.stringify(input)},false),
  correctPayment:(paymentId:string,input:{amount:string;transactionDate:string;reason:string;version:number})=>request<ApiPayment>(`/api/payments/${encodeURIComponent(paymentId)}/correct`,{method:'PATCH',body:JSON.stringify(input)},false),
  deletePayment:(paymentId:string,version:number)=>request<{id:string}>(`/api/payments/${encodeURIComponent(paymentId)}`,{method:'DELETE',body:JSON.stringify({version})},false),
  payRemaining:(eventId:string,input:{transactionDate:string;idempotencyKey:string})=>request<ApiPayment>(`/api/events/${encodeURIComponent(eventId)}/pay-remaining`,{method:'POST',body:JSON.stringify(input)},false),
  deleteEvent:(eventId:string,version:number)=>request<{id:string}>(`/api/events/${encodeURIComponent(eventId)}`,{method:'DELETE',body:JSON.stringify({version})},false),
  settleExpense:(expenseId:string,input:{paymentDate:string;amount:string;idempotencyKey:string})=>request<ApiSettlement>(`/api/expenses/${encodeURIComponent(expenseId)}/settlements`,{method:'POST',body:JSON.stringify(input)},false),
}
export const authApi={
  googleConfig:()=>request<{clientId:string|null}>('/api/auth/google/config',{},false),
  me:()=>request<SessionUser>('/api/auth/me',{},false),
  login:(email:string,password:string)=>request<SessionUser>('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})},false),
  google:(credential:string)=>request<SessionUser>('/api/auth/google',{method:'POST',body:JSON.stringify({credential})},false),
  logout:()=>requestVoid('/api/auth/logout',{method:'POST'}),
}
export type DesktopGoogleStatus={status:'pending'}|{status:'complete';user:SessionUser}
export const desktopGoogleApi={
  config:()=>request<{enabled:boolean}>('/api/auth/google/desktop/config',{},false),
  start:()=>request<{flowId:string;authorizationUrl:string}>('/api/auth/google/desktop/start',{method:'POST'},false),
  status:(flowId:string)=>request<DesktopGoogleStatus>(`/api/auth/google/desktop/status?flowId=${encodeURIComponent(flowId)}`,{},false),
}
export const quickExpenseApi = {
  list:()=>request<ApiQuickExpense[]>('/api/quick-expenses'),
  save:(id:string,input:Pick<ApiQuickExpense,'name'|'category'|'amount'|'expenseDate'|'businessUnit'|'notes'|'paymentMethod'>)=>request<ApiQuickExpense>(`/api/quick-expenses/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(input)},false),
}
export const directIncomeApi = {
  list:()=>request<ApiDirectIncome[]>('/api/direct-income'),
  save:(id:string,input:Pick<ApiDirectIncome,'name'|'amount'|'businessUnit'|'expectedDate'|'receivedDate'|'notes'>)=>request<ApiDirectIncome>(`/api/direct-income/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(input)},false),
  receive:(id:string,receivedDate:string,version:number)=>request<ApiDirectIncome>(`/api/direct-income/${encodeURIComponent(id)}/receive`,{method:'PATCH',body:JSON.stringify({receivedDate,version})},false),
  delete:(id:string,version:number)=>request<ApiDirectIncome>(`/api/direct-income/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify({version})},false),
}
export const testLoginApi={
  config:()=>request<{enabled:boolean}>('/api/auth/test-login/config',{},false),
  login:()=>request<SessionUser>('/api/auth/test-login',{method:'POST'},false),
}
export const payrollApi={list:()=>request<ApiPayroll[]>('/api/payroll')}
export const payrollDirectoryApi={workers:()=>request<ApiWorker[]>('/api/workers'),createWorker:(name:string)=>request<ApiWorker>('/api/workers',{method:'POST',body:JSON.stringify({name})},false)}
export const weeklyPayrollApi={
  list:()=>request<ApiWeeklyPayroll[]>('/api/weekly-payroll'),
  legacy:()=>request<LegacyPayroll>('/api/weekly-payroll/legacy'),
  save:(id:string,input:WeeklyPayrollInput)=>request<ApiWeeklyPayroll>(`/api/weekly-payroll/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(input)},false),
  pay:(id:string,input:{paymentDate:string;idempotencyKey:string;version:number})=>request<ApiWeeklyPayroll>(`/api/weekly-payroll/${encodeURIComponent(id)}/pay`,{method:'POST',body:JSON.stringify(input)},false),
  reverse:(id:string,input:{reason:string;idempotencyKey:string;version:number})=>request<ApiWeeklyPayroll>(`/api/weekly-payroll/${encodeURIComponent(id)}/reverse`,{method:'POST',body:JSON.stringify(input)},false),
  delete:(id:string,version:number)=>request<{id:string}>(`/api/weekly-payroll/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify({version})},false),
  templates:()=>request<ApiTeamTemplate[]>('/api/team-templates'),
  saveTemplate:(id:string,input:Omit<import('../server/weekly').TeamInput,'id'>)=>request<ApiTeamTemplate>(`/api/team-templates/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(input)},false),
}
export const reportApi={monthly:(month:string)=>requestFile(`/api/reports/monthly.xlsx?month=${encodeURIComponent(month)}`)}
export const healthApi={status:async()=>{const response=await fetch(`${baseUrl}/health`);if(!response.ok)throw new ApiError('server',response.status);return response.json() as Promise<{status:string}>}}
