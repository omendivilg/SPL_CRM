import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { ZodError } from 'zod'
import type { Authenticator } from './auth.js'
import { registerAuthRoutes, type GoogleVerifier } from './auth.js'
import { agreedPriceSchema, deleteVersionSchema, eventBudgetSchema, expenseSchema, operationalEventSchema, ownerEventSchema, payRemainingSchema, paymentCorrectionSchema, paymentSchema, settlementSchema, toCoordinatorEvent } from './domain.js'
import type { EventRepository } from './repository.js'
import type { SessionStore } from './sessions.js'
import {workerInputSchema,type PayrollStore} from './payroll.js'
import { expenseProjection, payrollProjection, type WeeklyStore } from './weekly.js'
import { registerWeeklyRoutes } from './weekly-routes.js'
import {createMonthlyReport,reportMonthSchema} from './report.js'
import {saveQuickExpense} from './quick-expense.js'
import { deleteDirectIncome, receiveDirectIncome, saveDirectIncome } from './direct-income.js'
import {z} from 'zod'

export function buildApp(repository: EventRepository, authenticate: Authenticator, sessions?:SessionStore,verifyGoogle?:GoogleVerifier,payroll?:PayrollStore,weekly?:WeeklyStore, options: { checkHealth?: () => Promise<void> } = {}) {
  const app = Fastify({ bodyLimit: 32 * 1024, logger: false })
  app.register(helmet, { contentSecurityPolicy: false })
  app.register(cors, { origin: false })
  app.register(cookie)
  app.register(rateLimit,{global:false})
  if(sessions)app.after(()=>registerAuthRoutes(app,sessions,verifyGoogle))
  app.addHook('onRequest', async (request, reply) => {
    const route = request.routeOptions.url ?? request.url.split('?')[0]
    if (!route.startsWith('/api/') || route === '/api/auth/login' || route === '/api/auth/google' || route === '/api/auth/google/config' || route === '/api/auth/google/native' || route === '/api/auth/test-login' || route === '/api/auth/test-login/config' || route.startsWith('/api/auth/google/desktop/')) return
    const principal = await authenticate(request)
    if (!principal) return reply.code(401).send({ error: 'No autorizado' })
    request.principal = principal
  })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'Solicitud inválida', issues: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) })
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : undefined
    if (statusCode === 413) return reply.code(413).send({ error: 'Solicitud demasiado grande' })
    if (statusCode && statusCode < 500) return reply.code(statusCode).send({ error: statusCode === 409 && error instanceof Error ? error.message : 'Solicitud inválida' })
    return reply.code(500).send({ error: 'Error interno' })
  })
  app.get('/health', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try {
      await options.checkHealth?.()
      return { status: 'ok' }
    } catch {
      return reply.code(503).send({ status: 'unavailable' })
    }
  })
  app.get('/api/events', async request => {
    const events = await repository.list(request.principal)
    return { data: request.principal.role === 'coordinator' ? events.map(toCoordinatorEvent) : events }
  })
  if (weekly) {
    app.get('/api/direct-income', async (request, reply) => {
      if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
      return { data: (await weekly.readWeekly()).directIncomes.filter(income => !income.deletedAt).sort((a, b) => b.expectedDate.localeCompare(a.expectedDate)) }
    })
    app.put<{Params:{id:string}}>('/api/direct-income/:id', async (request, reply) => {
      if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
      const id = z.uuid().parse(request.params.id)
      return reply.code(201).send({ data: await weekly.transactWeekly(state => saveDirectIncome(state, id, request.body, request.principal)) })
    })
    app.patch<{Params:{id:string}}>('/api/direct-income/:id/receive', async (request, reply) => {
      if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
      const id = z.uuid().parse(request.params.id)
      const income = await weekly.transactWeekly(state => receiveDirectIncome(state, id, request.body, request.principal))
      return income ? { data: income } : reply.code(404).send({ error: 'Utilidad no encontrada' })
    })
    app.delete<{Params:{id:string}}>('/api/direct-income/:id', async (request, reply) => {
      if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
      const id = z.uuid().parse(request.params.id)
      const income = await weekly.transactWeekly(state => deleteDirectIncome(state, id, request.body, request.principal))
      return income ? { data: income } : reply.code(404).send({ error: 'Utilidad no encontrada' })
    })
    app.get('/api/quick-expenses', async (request, reply) => {
      if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
      return { data: (await weekly.readWeekly()).quickExpenses.sort((a,b) => b.expenseDate.localeCompare(a.expenseDate)) }
    })
    app.put<{Params:{id:string}}>('/api/quick-expenses/:id', async (request, reply) => {
      if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
      const id = z.uuid().parse(request.params.id)
      const expense = await weekly.transactWeekly(state => saveQuickExpense(state, id, request.body, request.principal))
      return reply.code(201).send({ data: expense })
    })
  }
  app.get<{Params:{id:string}}>('/api/events/:id', async (request, reply) => {
    if (request.params.id.length > 100) return reply.code(400).send({ error: 'Identificador inválido' })
    const event = await repository.findById(request.params.id, request.principal)
    if (!event) return reply.code(404).send({ error: 'Evento no encontrado' })
    return { data: request.principal.role === 'coordinator' ? toCoordinatorEvent(event) : event }
  })
  app.post('/api/events', async (request, reply) => {
    const schema = request.principal.role === 'coordinator' ? operationalEventSchema : ownerEventSchema
    const input = schema.parse(request.body)
    const event = await repository.create(input, request.principal)
    return reply.code(201).send({ data: request.principal.role === 'coordinator' ? toCoordinatorEvent(event) : event })
  })
  app.patch<{Params:{id:string}}>('/api/events/:id/budget',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});const {payrollBudget}=eventBudgetSchema.parse(request.body);const event=await repository.updatePayrollBudget(request.params.id,payrollBudget,request.principal);if(!event)return reply.code(404).send({error:'Evento no encontrado'});return{data:event}})
  app.patch<{Params:{id:string}}>('/api/events/:id/price',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});if(!repository.updateAgreedPrice)return reply.code(501).send({error:'Actualización no disponible'});const event=await repository.updateAgreedPrice(request.params.id,agreedPriceSchema.parse(request.body),request.principal);if(!event)return reply.code(409).send({error:'El evento cambió o no existe'});return{data:event}})
  app.delete<{Params:{id:string}}>('/api/events/:id',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});if(!repository.deleteEvent)return reply.code(501).send({error:'Eliminación no disponible'});const {version}=deleteVersionSchema.parse(request.body);const deleted=await repository.deleteEvent(request.params.id,version,request.principal);if(!deleted)return reply.code(404).send({error:'Evento no encontrado'});return{data:{id:request.params.id}}})
  app.post<{Params:{id:string}}>('/api/events/:id/expenses', async (request, reply) => {
    if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
    const input = expenseSchema.parse(request.body)
    const expense = await repository.addExpense(request.params.id, input, request.principal)
    if (!expense) return reply.code(404).send({ error: 'Evento no encontrado' })
    return reply.code(201).send({ data: expense })
  })
  app.get<{Params:{id:string}}>('/api/events/:id/expenses', async (request, reply) => {
    if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
    const expenses = await repository.listExpenses(request.params.id, request.principal)
    if (!expenses) return reply.code(404).send({ error: 'Evento no encontrado' })
    return { data: [...expenses, ...(weekly ? expenseProjection(await weekly.readWeekly()).filter(e => e.eventId === request.params.id) : [])] }
  })
  app.post<{Params:{id:string}}>('/api/events/:id/payments',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});const payment=await repository.addPayment(request.params.id,paymentSchema.parse(request.body),request.principal);if(!payment)return reply.code(404).send({error:'Evento no encontrado'});return reply.code(201).send({data:payment})})
  app.post<{Params:{id:string}}>('/api/events/:id/pay-remaining',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});if(!repository.payRemaining)return reply.code(501).send({error:'Pago completo no disponible'});const payment=await repository.payRemaining(request.params.id,payRemainingSchema.parse(request.body),request.principal);if(!payment)return reply.code(404).send({error:'Evento no encontrado'});return reply.code(201).send({data:payment})})
  app.get<{Params:{id:string}}>('/api/events/:id/payments',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});const payments=await repository.listPayments(request.params.id,request.principal);if(!payments)return reply.code(404).send({error:'Evento no encontrado'});return {data:payments}})
  app.patch<{Params:{id:string}}>('/api/payments/:id/correct',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});if(!repository.correctPayment)return reply.code(501).send({error:'Corrección no disponible'});const payment=await repository.correctPayment(request.params.id,paymentCorrectionSchema.parse(request.body),request.principal);if(!payment)return reply.code(404).send({error:'Movimiento no encontrado'});return{data:payment}})
  app.delete<{Params:{id:string}}>('/api/payments/:id',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});if(!repository.deletePayment)return reply.code(501).send({error:'Eliminación no disponible'});const {version}=deleteVersionSchema.parse(request.body);const deleted=await repository.deletePayment(request.params.id,version,request.principal);if(!deleted)return reply.code(404).send({error:'Movimiento no encontrado'});return{data:{id:request.params.id}}})
  app.post<{Params:{id:string}}>('/api/expenses/:id/settlements',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});const settlement=await repository.addSettlement(request.params.id,settlementSchema.parse(request.body),request.principal);if(!settlement)return reply.code(404).send({error:'Gasto no encontrado'});return reply.code(201).send({data:settlement})})
  app.get('/api/expense-settlements',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});return{data:await repository.listSettlements(request.principal)}})
  if (payroll) {
    app.get('/api/payroll', async (request, reply) => {
      if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
      return { data: weekly ? payrollProjection(await weekly.readWeekly()) : await payroll.listPayroll() }
    })
    app.get('/api/workers', async (request, reply) => {
      if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
      const workers = await payroll.listWorkers()
      return { data: [...workers, ...(weekly ? (await weekly.readWeekly()).importedWorkers.filter(w => !workers.some(existing => existing.id === w.id)) : [])] }
    })
    app.post('/api/workers', async (request, reply) => {
      if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
      const input = workerInputSchema.parse(request.body)
      if ((await payroll.listWorkers()).some(w => w.name.trim().toLocaleLowerCase() === input.name.toLocaleLowerCase())) return reply.code(409).send({ error: 'Ya existe un trabajador con ese nombre.' })
      return reply.code(201).send({ data: await payroll.createWorker(input, request.principal) })
    })
  }
  if (payroll && weekly) registerWeeklyRoutes(app, payroll, weekly, repository)
  if(payroll)app.get<{Querystring:{month?:string}}>('/api/reports/monthly.xlsx',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});const month=reportMonthSchema.parse(request.query.month);const events=await repository.list(request.principal);const weeklyState=weekly?await weekly.readWeekly():undefined;const expenses=[...(await Promise.all(events.map(event=>repository.listExpenses(event.id,request.principal)))).flatMap(items=>items??[]),...(weeklyState?expenseProjection(weeklyState).filter(e=>e.scope==='event'):[])];const payments=(await Promise.all(events.map(event=>repository.listPayments(event.id,request.principal)))).flatMap(items=>items??[]);const content=await createMonthlyReport({month,generatedAt:new Date(),events,expenses,payments,expenseSettlements:await repository.listSettlements(request.principal),payroll:weeklyState?payrollProjection(weeklyState):await payroll.listPayroll(),payrollSettlements:weeklyState?weeklyState.legacySettlements:await payroll.listPayrollSettlements(),weekly:weeklyState});return reply.header('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition',`attachment; filename="SPL-reporte-${month}.xlsx"`).send(content)})
  return app
}

declare module 'fastify' {
  interface FastifyRequest { principal: import('./domain.js').Principal }
}
