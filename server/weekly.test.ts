import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DevelopmentStore } from './dev.js'
import { PersistentDevelopmentStore } from './persistent-store.js'
import { buildApp } from './app.js'
import { deleteWeekly, emptyWeekly, expenseProjection, migrateWeekly, payWeekly, reverseWeekly, saveTeam, saveWeekly, upgradeWeekly, type WeeklyInput } from './weekly.js'
import ExcelJS from 'exceljs'

const principal = { userId: 'owner', role: 'owner' as const, unit: null }
const worker = { id: randomUUID(), name: 'Andrea', active: true }
const secondWorker = { id: randomUUID(), name: 'Luis', active: true }
const makeInput = () => ({ id: randomUUID(), version: 0, idempotencyKey: randomUUID(), businessUnit: 'SPL' as const, periodStart: '2026-09-14', periodEnd: '2026-09-20',
  lines: [worker,secondWorker].map(w=>({ id: randomUUID(), employeeId: w.id, baseCost: '1000.10', additions: '100.20', deductions: '50.05', allocations: [{ scope: 'warehouse' as const, amount: '1100.30' }] })),
  expenses: [{ id: randomUUID(), concept: 'Transporte', category: 'Transporte', amount: '300.20', notes: '', scope: 'warehouse' as const }],
})
const directory=[worker,secondWorker]

describe('whole weekly payroll', () => {
  it('assigns wages and expenses to one unit and rejects cross-unit events', () => {
    const state=emptyWeekly(),splEvent=randomUUID(),fifthEvent=randomUUID(),events=new Map([[splEvent,'SPL' as const],[fifthEvent,'5to Elemento' as const]])
    const input: WeeklyInput=makeInput()
    input.lines[0].allocations=[{scope:'event',eventId:splEvent,amount:'1100.30'}]
    const batch=saveWeekly(state,input,directory,events,principal)
    expect(batch.businessUnit).toBe('SPL')
    expect(expenseProjection(state)[0]).toMatchObject({businessUnit:'SPL',category:'Transporte'})
    const wrong={...makeInput(),businessUnit:'5to Elemento',lines:makeInput().lines.map(line=>({...line,allocations:[{scope:'event',eventId:splEvent,amount:'1100.30'}]}))}
    expect(()=>saveWeekly(state,wrong,directory,events,principal)).toThrow('otra unidad')
    const expenseWrong={...makeInput(),expenses:[{...makeInput().expenses[0],scope:'event',eventId:fifthEvent}]}
    expect(()=>saveWeekly(state,expenseWrong,directory,events,principal)).toThrow('otra unidad')
  })
  it('allows changing the unit of an unpaid payroll after reallocating event costs',()=>{
    const state=emptyWeekly(),splEvent=randomUUID(),fifthEvent=randomUUID(),events=new Map([[splEvent,'SPL' as const],[fifthEvent,'5to Elemento' as const]])
    const input: WeeklyInput=makeInput()
    input.lines[0].allocations=[{scope:'event',eventId:splEvent,amount:'1100.30'}]
    const first=saveWeekly(state,input,directory,events,principal)
    const changed={...input,version:first.version,idempotencyKey:randomUUID(),businessUnit:'5to Elemento',lines:input.lines.map(line=>({...line,allocations:line.allocations.map(allocation=>allocation.scope==='event'?{...allocation,eventId:fifthEvent}:allocation)}))}
    const second=saveWeekly(state,changed,directory,events,principal)
    expect(second.businessUnit).toBe('5to Elemento')
    expect(second.lines[0].allocations[0].eventId).toBe(fifthEvent)
  })
  it('upgrades older batches and quick expenses without changing event allocations', () => {
    const state=emptyWeekly(),input: WeeklyInput=makeInput(),eventId=randomUUID()
    input.lines[0].allocations=[{scope:'event',eventId,amount:'1100.30'}]
    const batch=saveWeekly(state,input,directory,new Map([[eventId,'SPL' as const]]),principal)
    const old=structuredClone(state) as unknown as {schemaVersion:number;batches:Array<{businessUnit?:string;expenses:Array<{category?:string}>}>;templates:Array<{businessUnit?:string}>;quickExpenses:Array<{businessUnit:string}>}
    old.schemaVersion=2;delete old.batches[0].businessUnit;delete old.batches[0].expenses[0].category
    old.quickExpenses.push({businessUnit:'SPL consolidado'})
    const upgraded=upgradeWeekly(old)
    expect(upgraded.schemaVersion).toBe(3)
    expect(upgraded.batches[0]).toMatchObject({businessUnit:'SPL',expenses:[{category:'Otros gastos'}]})
    expect(upgraded.batches[0].lines[0].allocations[0].eventId).toBe(eventId)
    expect(upgraded.quickExpenses[0].businessUnit).toBe('SPL')
    expect(batch.lines[0].allocations[0].eventId).toBe(eventId)
  })
  it('stores an optional name without changing older unnamed payrolls', async () => {
    const store=new DevelopmentStore(),unnamed=makeInput()
    const first=await store.transactWeekly(state=>saveWeekly(state,unnamed,directory,new Map(),principal))
    expect(first.name).toBeUndefined()
    const named=await store.transactWeekly(state=>saveWeekly(state,{...makeInput(),name:'Equipo de montaje'},directory,new Map(),principal))
    expect(named.name).toBe('Equipo de montaje')
    const renamed=await store.transactWeekly(state=>saveWeekly(state,{...makeInput(),id:named.id,version:named.version,name:'  Semana especial  '},directory,new Map(),principal))
    expect(renamed.name).toBe('Semana especial')
    expect((await store.readWeekly()).batches.find(batch=>batch.id===first.id)?.name).toBeUndefined()
  })
  it('allows an expense-only payroll and archives it when deleted', async () => {
    const store=new DevelopmentStore(),input={...makeInput(),lines:[]}
    const saved=await store.transactWeekly(state=>saveWeekly(state,input,directory,new Map(),principal))
    expect(saved).toMatchObject({wagesTotal:'0.00',expensesTotal:'300.20',total:'300.20',status:'unpaid'})
    await expect(store.transactWeekly(state=>saveWeekly(state,{...input,lines:[],expenses:[]},directory,new Map(),principal))).rejects.toThrow()
    await store.transactWeekly(state=>deleteWeekly(state,saved.id,{version:saved.version},principal))
    const state=await store.readWeekly()
    expect(state.batches).toHaveLength(0)
    expect(state.archive).toContainEqual(expect.objectContaining({kind:'deleted-weekly-payroll'}))
  })
  it('deletes a paid payroll after confirmation through the API and removes its active financial projections', async () => {
    const store = new DevelopmentStore(), app = buildApp(store, async () => principal, undefined, undefined, store, store)
    const input = { ...makeInput(), lines: [] }
    const saved = await store.transactWeekly(state => saveWeekly(state, input, directory, new Map(), principal))
    const paid = await store.transactWeekly(state => payWeekly(state, saved.id, { version: saved.version, paymentDate: '2026-09-22', idempotencyKey: randomUUID() }, principal))
    const stale = await app.inject({ method: 'DELETE', url: `/api/weekly-payroll/${saved.id}`, payload: { version: saved.version } })
    expect(stale.statusCode).toBe(409)
    const deleted = await app.inject({ method: 'DELETE', url: `/api/weekly-payroll/${saved.id}`, payload: { version: paid.version } })
    expect(deleted.statusCode).toBe(200)
    const state = await store.readWeekly()
    expect(state.batches).toHaveLength(0)
    expect(state.archive).toContainEqual(expect.objectContaining({ kind: 'deleted-weekly-payroll', batch: expect.objectContaining({ status: 'paid', payments: expect.arrayContaining([expect.objectContaining({ amount: '300.20' })]) }) }))
    expect((await app.inject({ method: 'GET', url: '/api/weekly-payroll' })).json().data).toHaveLength(0)
    await app.close()
  })
  it('deletes a paid event even when a payroll still references its cost allocation', async () => {
    const store = new DevelopmentStore(), app = buildApp(store, async () => principal, undefined, undefined, store, store)
    const event = await store.create({ businessUnit: 'SPL', clientName: 'Cliente', venue: 'Salón', eventDate: '2026-09-20', operationalStatus: 'Pendiente', agreedPrice: '100.00', payrollBudget: '0.00', extraExpenseBudget: '0.00' }, principal)
    await store.addPayment(event.id, { transactionDate: '2026-09-20', amount: '100.00', kind: 'payment', idempotencyKey: randomUUID() }, principal)
    const input: WeeklyInput = makeInput()
    input.lines[0].allocations = [{ scope: 'event', eventId: event.id, amount: '1100.30' }]
    const batch = await store.transactWeekly(state => saveWeekly(state, input, directory, new Map([[event.id, event.businessUnit]]), principal))
    expect((await app.inject({ method: 'DELETE', url: `/api/events/${event.id}`, payload: { version: event.version } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/events' })).json().data).toHaveLength(0)
    expect((await store.readWeekly()).batches[0].id).toBe(batch.id)
    await app.close()
  })
  it('saves all workers and optional expenses atomically, pays once and reverses with history', async () => {
    const store = new DevelopmentStore(), input=makeInput()
    const batch=await store.transactWeekly(state=>saveWeekly(state,input,directory,new Map(),principal))
    expect(batch).toMatchObject({status:'unpaid',wagesTotal:'2100.50',expensesTotal:'300.20',total:'2400.70'})
    expect(await store.transactWeekly(state=>saveWeekly(state,input,directory,new Map(),principal))).toEqual(batch)
    const payment={paymentDate:'2026-09-20',version:batch.version,idempotencyKey:randomUUID()}
    const paid=await store.transactWeekly(state=>payWeekly(state,batch.id,payment,principal))
    expect(paid.status).toBe('paid');expect(paid.payments).toHaveLength(1);expect(paid.payments[0].amount).toBe('2400.70')
    expect(await store.transactWeekly(state=>payWeekly(state,batch.id,payment,principal))).toEqual(paid)
    await expect(store.transactWeekly(state=>saveWeekly(state,{...input,version:paid.version,idempotencyKey:randomUUID()},directory,new Map(),principal))).rejects.toThrow('solo lectura')
    const reversed=await store.transactWeekly(state=>reverseWeekly(state,batch.id,{version:paid.version,idempotencyKey:randomUUID(),reason:'Fecha incorrecta'},principal))
    expect(reversed.status).toBe('unpaid');expect(reversed.payments[0].reversalReason).toBe('Fecha incorrecta')
    const edited=await store.transactWeekly(state=>saveWeekly(state,{...input,expenses:[],version:reversed.version,idempotencyKey:randomUUID()},directory,new Map(),principal))
    expect(edited.total).toBe('2100.50');expect(edited.history).toHaveLength(4)
  })
  it('rejects duplicate people, stale versions, partial payments and retries with altered input', async () => {
    const store=new DevelopmentStore(),input=makeInput()
    await expect(store.transactWeekly(state=>saveWeekly(state,{...input,lines:[input.lines[0],{...input.lines[0],id:randomUUID()}]},directory,new Map(),principal))).rejects.toThrow('repetir')
    expect((await store.readWeekly()).batches).toHaveLength(0)
    const saved=await store.transactWeekly(state=>saveWeekly(state,input,directory,new Map(),principal))
    await expect(store.transactWeekly(state=>saveWeekly(state,{...input,idempotencyKey:randomUUID()},directory,new Map(),principal))).rejects.toThrow('cambió')
    await expect(store.transactWeekly(state=>saveWeekly(state,{...input,expenses:[]},directory,new Map(),principal))).rejects.toThrow('solicitud cambió')
    await expect(store.transactWeekly(state=>payWeekly(state,saved.id,{version:1,paymentDate:'2026-09-20',idempotencyKey:randomUUID(),amount:'20'},principal))).rejects.toThrow()
    expect((await store.readWeekly()).batches[0].status).toBe('unpaid')
  })
  it('serializes concurrent payments and keeps working after a failed transaction', async()=>{
    const store=new DevelopmentStore(),input=makeInput()
    await store.transactWeekly(state=>saveWeekly(state,input,directory,new Map(),principal))
    const results=await Promise.allSettled([1,2].map(()=>store.transactWeekly(state=>payWeekly(state,input.id,{version:1,paymentDate:'2026-09-20',idempotencyKey:randomUUID()},principal))))
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
    expect((await store.readWeekly()).batches[0].payments).toHaveLength(1)
  })
  it('validates complete distributions, unavailable destinations and deductions before committing', async()=>{
    const store=new DevelopmentStore(),input=makeInput()
    for(const broken of [
      {...input,lines:[{...input.lines[0],deductions:'9000'}]},
      {...input,lines:[{...input.lines[0],allocations:[{scope:'warehouse',amount:'1'}]}]},
      {...input,expenses:[{...input.expenses[0],scope:'event',eventId:randomUUID()}]},
      {...input,periodEnd:'2026-09-01'},
    ]) await expect(store.transactWeekly(state=>saveWeekly(state,broken,directory,new Map(),principal))).rejects.toThrow()
    expect((await store.readWeekly()).batches).toHaveLength(0)
  })
  it('saves independent team templates with exactly one default and no dates or destinations',()=>{
    const state=emptyWeekly(),input=makeInput(),lines=input.lines.map(({employeeId,baseCost,additions,deductions})=>({employeeId,baseCost,additions,deductions}))
    const template={id:randomUUID(),version:0,idempotencyKey:randomUUID(),name:'Equipo habitual',isDefault:true,businessUnit:'SPL' as const,lines,expenses:[{concept:'Alimentos',category:'Alimentos',amount:'100',notes:''}]}
    saveTeam(state,template,directory);saveTeam(state,{...template,id:randomUUID(),idempotencyKey:randomUUID(),name:'Otro equipo'},directory)
    expect(state.templates.filter(t=>t.isDefault)).toHaveLength(1)
    saveTeam(state,{...template,id:randomUUID(),idempotencyKey:randomUUID(),name:'Equipo 5to',businessUnit:'5to Elemento'},directory)
    expect(state.templates.filter(t=>t.isDefault).map(t=>t.businessUnit).sort()).toEqual(['5to Elemento','SPL'])
    expect(()=>saveTeam(state,{...template,periodStart:'2026-09-14'},directory)).toThrow()
    const batch=saveWeekly(state,input,directory,new Map(),principal);batch.lines[0].baseCost='200'
    expect(state.templates[0].lines[0].baseCost).toBe('1000.10')
  })
  it('preserves partial legacy payments and old draft captures without pretending they are paid',()=>{
    const input=makeInput(),state=emptyWeekly(),record={...input.lines[0],employeeName:'Andrea',periodStart:input.periodStart,periodEnd:input.periodEnd,laborCost:'1100.30',netPay:'1050.25',allocationTotal:'1100.30',paidAmount:'300.00',outstandingAmount:'750.25'}
    migrateWeekly(state,[record],[],directory,[]);migrateWeekly(state,[record],[],directory,[])
    expect(state.batches).toHaveLength(0);expect(state.legacy).toHaveLength(1);expect(state.legacy[0].paidAmount).toBe('300.00')
    const upgraded=upgradeWeekly({batches:[{status:'draft',lines:[record],settlements:[]}],templates:[],migrated:true})
    expect(upgraded.legacy[0].archivedDraft).toBe(true);expect(upgraded.archive).toHaveLength(1)
  })
  it('persists payments across reopening and leaves both disk and memory unchanged on a failed write',async()=>{
    const directoryPath=await mkdtemp(join(tmpdir(),'spl-payroll-v2-')),path=join(directoryPath,'data.json'),store=await PersistentDevelopmentStore.open(path),input=makeInput()
    await store.transactWeekly(state=>saveWeekly(state,input,directory,new Map(),principal))
    const before=await readFile(path,'utf8')
    await mkdir(`${path}.tmp`)
    await expect(store.transactWeekly(state=>payWeekly(state,input.id,{version:1,paymentDate:'2026-09-20',idempotencyKey:randomUUID()},principal))).rejects.toThrow()
    expect((await store.readWeekly()).batches[0].status).toBe('unpaid');expect(await readFile(path,'utf8')).toBe(before)
    await rm(`${path}.tmp`,{recursive:true})
    await store.transactWeekly(state=>payWeekly(state,input.id,{version:1,paymentDate:'2026-09-20',idempotencyKey:randomUUID()},principal))
    expect((await (await PersistentDevelopmentStore.open(path)).readWeekly()).batches[0].status).toBe('paid')
  })
  it('exposes only full-batch payments and projects expenses once into events and Excel',async()=>{
    const store=new DevelopmentStore();store.workers=directory
    const event=await store.create({businessUnit:'SPL',clientName:'Prueba',venue:'Salón',eventDate:'2026-09-20',operationalStatus:'Confirmado',payrollBudget:'0.00',extraExpenseBudget:'0.00'},principal)
    const app=buildApp(store,async req=>req.headers.authorization==='coordinator'?{...principal,role:'coordinator',unit:'SPL'}:principal,undefined,undefined,store,store)
    const input=makeInput(),payload={...input,expenses:[{...input.expenses[0],scope:'event',eventId:event.id}]};const {id,...body}=payload
    const saved=await app.inject({method:'PUT',url:`/api/weekly-payroll/${id}`,payload:body});expect(saved.statusCode).toBe(200)
    expect((await app.inject({url:'/api/weekly-payroll',headers:{authorization:'coordinator'}})).statusCode).toBe(403)
    expect((await app.inject({method:'POST',url:`/api/weekly-payroll/${id}/pay`,payload:{version:1,idempotencyKey:randomUUID(),paymentDate:'2026-09-20',amount:'1'}})).statusCode).toBe(400)
    expect((await app.inject({method:'POST',url:`/api/payroll/${input.lines[0].id}/settlements`,payload:{}})).statusCode).toBe(404)
    await app.inject({method:'POST',url:`/api/weekly-payroll/${id}/pay`,payload:{version:1,idempotencyKey:randomUUID(),paymentDate:'2026-09-20'}})
    const expenses=(await app.inject(`/api/events/${event.id}/expenses`)).json().data
    expect(expenses).toHaveLength(1);expect(expenses[0]).toMatchObject({amount:'300.20',paidAmount:'300.20',source:'payroll'})
    expect(store.expenses.size).toBe(0)
    const report=await app.inject('/api/reports/monthly.xlsx?month=2026-09');expect(report.statusCode).toBe(200)
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(report.rawPayload as any)
    expect(workbook.getWorksheet('Nóminas semanales')?.getCell('I5').value).toBe(2400.7)
    expect(workbook.getWorksheet('Movimientos')?.rowCount).toBe(5)
    expect(workbook.getWorksheet('Movimientos')?.getCell('D5').value).toBe(2400.7)
    expect(workbook.getWorksheet('Eventos')?.getCell('J5').value).toBe(300.2)
    await app.close()
  })
})
