import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { ZodError } from 'zod'
import type { Authenticator } from './auth.js'
import { registerAuthRoutes, type GoogleVerifier } from './auth.js'
import { expenseSchema, operationalEventSchema, ownerEventSchema, paymentSchema, settlementSchema, toCoordinatorEvent } from './domain.js'
import type { EventRepository } from './repository.js'
import type { SessionStore } from './sessions.js'
import {calculatePayroll,type PayrollStore} from './payroll.js'
import {createMonthlyReport,reportMonthSchema} from './report.js'

export function buildApp(repository: EventRepository, authenticate: Authenticator, sessions?:SessionStore,verifyGoogle?:GoogleVerifier,payroll?:PayrollStore) {
  const app = Fastify({ bodyLimit: 32 * 1024, logger: false })
  app.register(helmet, { contentSecurityPolicy: false })
  app.register(cors, { origin: false })
  app.register(cookie)
  app.register(rateLimit,{global:false})
  if(sessions)app.after(()=>registerAuthRoutes(app,sessions,verifyGoogle))
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' || request.url === '/api/auth/login' || request.url === '/api/auth/google') return
    const principal = await authenticate(request)
    if (!principal) return reply.code(401).send({ error: 'No autorizado' })
    request.principal = principal
  })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'Solicitud inválida', issues: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) })
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : undefined
    if (statusCode === 413) return reply.code(413).send({ error: 'Solicitud demasiado grande' })
    if (statusCode && statusCode < 500) return reply.code(statusCode).send({ error: 'Solicitud inválida' })
    return reply.code(500).send({ error: 'Error interno' })
  })
  app.get('/health', async () => ({ status: 'ok' }))
  app.get('/api/events', async request => {
    const events = await repository.list(request.principal)
    return { data: request.principal.role === 'coordinator' ? events.map(toCoordinatorEvent) : events }
  })
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
    return { data: expenses }
  })
  app.post<{Params:{id:string}}>('/api/events/:id/payments',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});const payment=await repository.addPayment(request.params.id,paymentSchema.parse(request.body),request.principal);if(!payment)return reply.code(404).send({error:'Evento no encontrado'});return reply.code(201).send({data:payment})})
  app.get<{Params:{id:string}}>('/api/events/:id/payments',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});const payments=await repository.listPayments(request.params.id,request.principal);if(!payments)return reply.code(404).send({error:'Evento no encontrado'});return {data:payments}})
  app.post<{Params:{id:string}}>('/api/expenses/:id/settlements',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});const settlement=await repository.addSettlement(request.params.id,settlementSchema.parse(request.body),request.principal);if(!settlement)return reply.code(404).send({error:'Gasto no encontrado'});return reply.code(201).send({data:settlement})})
  if(payroll){app.get('/api/payroll',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});return{data:await payroll.listPayroll()}});app.post('/api/payroll',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});return reply.code(201).send({data:await payroll.createPayroll(calculatePayroll(request.body),request.principal)})});app.post<{Params:{id:string}}>('/api/payroll/:id/settlements',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});const result=await payroll.settlePayroll(request.params.id,settlementSchema.parse(request.body),request.principal);if(!result)return reply.code(404).send({error:'Registro no encontrado'});return reply.code(201).send({data:result})})}
  if(payroll)app.get<{Querystring:{month?:string}}>('/api/reports/monthly.xlsx',async(request,reply)=>{if(request.principal.role==='coordinator')return reply.code(403).send({error:'Acceso denegado'});const month=reportMonthSchema.parse(request.query.month);const events=await repository.list(request.principal);const expenses=(await Promise.all(events.map(event=>repository.listExpenses(event.id,request.principal)))).flatMap(items=>items??[]);const payments=(await Promise.all(events.map(event=>repository.listPayments(event.id,request.principal)))).flatMap(items=>items??[]);const content=await createMonthlyReport({month,generatedAt:new Date(),events,expenses,payments,expenseSettlements:await repository.listSettlements(request.principal),payroll:await payroll.listPayroll(),payrollSettlements:await payroll.listPayrollSettlements()});return reply.header('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition',`attachment; filename="SPL-reporte-${month}.xlsx"`).send(content)})
  return app
}

declare module 'fastify' {
  interface FastifyRequest { principal: import('./domain.js').Principal }
}
