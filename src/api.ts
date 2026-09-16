export type ApiBusinessUnit = 'SPL' | '5to Elemento'
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
export type ApiExpense = { id:string;eventId:string;name:string;category:string;expenseDate:string;amount:string;paidAmount:string;supplier?:string|null;notes?:string|null;dueDate?:string|null;version:number }
export type ApiPayment={id:string;eventId:string;transactionDate:string;amount:string;kind:'payment'|'refund';idempotencyKey:string;createdAt:string}
export type ApiSettlement={id:string;expenseId:string;paymentDate:string;amount:string;idempotencyKey:string;createdAt:string;paidAmount:string}
export type ApiPayroll={id:string;employeeName:string;periodStart:string;periodEnd:string;baseCost:string;additions:string;deductions:string;laborCost:string;netPay:string;allocationTotal:string;paidAmount:string;outstandingAmount:string;allocations:Array<{scope:'event'|'warehouse';eventId?:string|null;amount:string}>}
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
    if (!response.ok) throw new ApiError(response.status===401?'unauthorized':response.status===403?'forbidden':response.status<500?'invalid':'server',response.status)
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
  list:()=>request<ApiEvent[]>('/api/events'),
  create:(input:CreateEventInput)=>request<ApiEvent>('/api/events',{method:'POST',body:JSON.stringify(input)},false),
  listExpenses:(eventId:string)=>request<ApiExpense[]>(`/api/events/${encodeURIComponent(eventId)}/expenses`),
  addExpense:(eventId:string,input:CreateExpenseInput)=>request<ApiExpense>(`/api/events/${encodeURIComponent(eventId)}/expenses`,{method:'POST',body:JSON.stringify(input)},false),
  listPayments:(eventId:string)=>request<ApiPayment[]>(`/api/events/${encodeURIComponent(eventId)}/payments`),
  addPayment:(eventId:string,input:{transactionDate:string;amount:string;kind:'payment'|'refund';idempotencyKey:string})=>request<ApiPayment>(`/api/events/${encodeURIComponent(eventId)}/payments`,{method:'POST',body:JSON.stringify(input)},false),
  settleExpense:(expenseId:string,input:{paymentDate:string;amount:string;idempotencyKey:string})=>request<ApiSettlement>(`/api/expenses/${encodeURIComponent(expenseId)}/settlements`,{method:'POST',body:JSON.stringify(input)},false),
}
export const authApi={
  me:()=>request<SessionUser>('/api/auth/me',{},false),
  login:(email:string,password:string)=>request<SessionUser>('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})},false),
  google:(credential:string)=>request<SessionUser>('/api/auth/google',{method:'POST',body:JSON.stringify({credential})},false),
  logout:()=>requestVoid('/api/auth/logout',{method:'POST'}),
}
export const payrollApi={list:()=>request<ApiPayroll[]>('/api/payroll'),create:(input:Omit<ApiPayroll,'id'|'laborCost'|'netPay'|'allocationTotal'|'paidAmount'|'outstandingAmount'>)=>request<ApiPayroll>('/api/payroll',{method:'POST',body:JSON.stringify(input)},false),settle:(id:string,input:{paymentDate:string;amount:string;idempotencyKey:string})=>request<{paidAmount:string;outstandingAmount:string}>(`/api/payroll/${encodeURIComponent(id)}/settlements`,{method:'POST',body:JSON.stringify(input)},false)}
export const reportApi={monthly:(month:string)=>requestFile(`/api/reports/monthly.xlsx?month=${encodeURIComponent(month)}`)}
