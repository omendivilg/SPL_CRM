import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PayrollStore } from './payroll.js'
import type { EventRepository } from './repository.js'
import { deleteWeekly, migrateWeekly, payWeekly, reverseWeekly, saveTeam, saveWeekly, type WeeklyStore } from './weekly.js'

export function registerWeeklyRoutes(app: FastifyInstance, payroll: PayrollStore, weekly: WeeklyStore, repository: EventRepository) {
  app.addHook('onReady', async () => {
    if (!(await weekly.readWeekly()).migrated) await weekly.transactWeekly(async state => {
      migrateWeekly(state, await payroll.listPayroll(), await payroll.listTemplates(), await payroll.listWorkers(), await payroll.listPayrollSettlements())
    })
  })
  app.get('/api/weekly-payroll', async (request, reply) => {
    if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
    return { data: (await weekly.readWeekly()).batches.sort((a,b) => b.periodEnd.localeCompare(a.periodEnd)) }
  })
  app.get('/api/weekly-payroll/legacy', async (request, reply) => {
    if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
    const state = await weekly.readWeekly()
    return { data: { entries: state.legacy, settlements: state.legacySettlements } }
  })
  app.put<{ Params: { id: string } }>('/api/weekly-payroll/:id', { bodyLimit: 256 * 1024 }, async (request, reply) => {
    if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
    z.uuid().parse(request.params.id)
    return { data: await weekly.transactWeekly(async state => saveWeekly(state, { ...(request.body as object), id: request.params.id }, await payroll.listWorkers(), new Set((await repository.list(request.principal)).map(e => e.id)), request.principal)) }
  })
  app.delete<{ Params: { id: string } }>('/api/weekly-payroll/:id', async (request, reply) => {
    if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
    z.uuid().parse(request.params.id)
    return { data: await weekly.transactWeekly(state => deleteWeekly(state, request.params.id, request.body, request.principal)) }
  })
  for (const action of ['pay', 'reverse'] as const) app.post<{ Params: { id: string } }>(`/api/weekly-payroll/:id/${action}`, async (request, reply) => {
    if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
    z.uuid().parse(request.params.id)
    return { data: await weekly.transactWeekly(state => (action === 'pay' ? payWeekly : reverseWeekly)(state, request.params.id, request.body, request.principal)) }
  })
  app.get('/api/team-templates', async (request, reply) => {
    if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
    return { data: (await weekly.readWeekly()).templates.sort((a,b) => a.name.localeCompare(b.name)) }
  })
  app.put<{ Params: { id: string } }>('/api/team-templates/:id', { bodyLimit: 256 * 1024 }, async (request, reply) => {
    if (request.principal.role === 'coordinator') return reply.code(403).send({ error: 'Acceso denegado' })
    z.uuid().parse(request.params.id)
    return { data: await weekly.transactWeekly(async state => saveTeam(state, { ...(request.body as object), id: request.params.id }, await payroll.listWorkers())) }
  })
}
