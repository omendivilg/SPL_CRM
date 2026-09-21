import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DevelopmentStore } from './dev.js'
import { PersistentDevelopmentStore } from './persistent-store.js'
import { buildApp } from './app.js'
import { emptyWeekly, migrateWeekly, payWeekly, reverseWeekly, saveTeam, saveWeekly, upgradeWeekly } from './weekly.js'
import ExcelJS from 'exceljs'

const principal = { userId: 'owner', role: 'owner' as const, unit: null }
const worker = { id: randomUUID(), name: 'Andrea', active: true }
const secondWorker = { id: randomUUID(), name: 'Luis', active: true }
const makeInput = () => ({ id: randomUUID(), version: 0, idempotencyKey: randomUUID(), periodStart: '2026-09-14', periodEnd: '2026-09-20',
  lines: [worker,secondWorker].map(w=>({ id: randomUUID(), employeeId: w.id, baseCost: '1000.10', additions: '100.20', deductions: '50.05', allocations: [{ scope: 'warehouse' as const, amount: '1100.30' }] })),
  expenses: [{ id: randomUUID(), concept: 'Transporte', amount: '300.20', notes: '', scope: 'warehouse' as const }],
})
const directory=[worker,secondWorker]

describe('whole weekly payroll', () => {
  it('saves all workers and optional expenses atomically, pays once and reverses with history', async () => {
    const store = new DevelopmentStore(), input=makeInput()
    const batch=await store.transactWeekly(state=>saveWeekly(state,input,directory,new Set(),principal))
    expect(batch).toMatchObject({status:'unpaid',wagesTotal:'2100.50',expensesTotal:'300.20',total:'2400.70'})
    expect(await store.transactWeekly(state=>saveWeekly(state,input,directory,new Set(),principal))).toEqual(batch)
    const payment={paymentDate:'2026-09-20',version:batch.version,idempotencyKey:randomUUID()}
    const paid=await store.transactWeekly(state=>payWeekly(state,batch.id,payment,principal))
    expect(paid.status).toBe('paid');expect(paid.payments).toHaveLength(1);expect(paid.payments[0].amount).toBe('2400.70')
    expect(await store.transactWeekly(state=>payWeekly(state,batch.id,payment,principal))).toEqual(paid)
    await expect(store.transactWeekly(state=>saveWeekly(state,{...input,version:paid.version,idempotencyKey:randomUUID()},directory,new Set(),principal))).rejects.toThrow('solo lectura')
    const reversed=await store.transactWeekly(state=>reverseWeekly(state,batch.id,{version:paid.version,idempotencyKey:randomUUID(),reason:'Fecha incorrecta'},principal))
    expect(reversed.status).toBe('unpaid');expect(reversed.payments[0].reversalReason).toBe('Fecha incorrecta')
    const edited=await store.transactWeekly(state=>saveWeekly(state,{...input,expenses:[],version:reversed.version,idempotencyKey:randomUUID()},directory,new Set(),principal))
    expect(edited.total).toBe('2100.50');expect(edited.history).toHaveLength(4)
  })
  it('rejects duplicate people, stale versions, partial payments and retries with altered input', async () => {
    const store=new DevelopmentStore(),input=makeInput()
    await expect(store.transactWeekly(state=>saveWeekly(state,{...input,lines:[input.lines[0],{...input.lines[0],id:randomUUID()}]},directory,new Set(),principal))).rejects.toThrow('repetir')
    expect((await store.readWeekly()).batches).toHaveLength(0)
    const saved=await store.transactWeekly(state=>saveWeekly(state,input,directory,new Set(),principal))
    await expect(store.transactWeekly(state=>saveWeekly(state,{...input,idempotencyKey:randomUUID()},directory,new Set(),principal))).rejects.toThrow('cambió')
    await expect(store.transactWeekly(state=>saveWeekly(state,{...input,expenses:[]},directory,new Set(),principal))).rejects.toThrow('solicitud cambió')
    await expect(store.transactWeekly(state=>payWeekly(state,saved.id,{version:1,paymentDate:'2026-09-20',idempotencyKey:randomUUID(),amount:'20'},principal))).rejects.toThrow()
    expect((await store.readWeekly()).batches[0].status).toBe('unpaid')
  })
  it('serializes concurrent payments and keeps working after a failed transaction', async()=>{
    const store=new DevelopmentStore(),input=makeInput()
    await store.transactWeekly(state=>saveWeekly(state,input,directory,new Set(),principal))
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
    ]) await expect(store.transactWeekly(state=>saveWeekly(state,broken,directory,new Set(),principal))).rejects.toThrow()
    expect((await store.readWeekly()).batches).toHaveLength(0)
  })
  it('saves independent team templates with exactly one default and no dates or destinations',()=>{
    const state=emptyWeekly(),input=makeInput(),lines=input.lines.map(({employeeId,baseCost,additions,deductions})=>({employeeId,baseCost,additions,deductions}))
    const template={id:randomUUID(),version:0,idempotencyKey:randomUUID(),name:'Equipo habitual',isDefault:true,lines,expenses:[{concept:'Alimentos',amount:'100',notes:''}]}
    saveTeam(state,template,directory);saveTeam(state,{...template,id:randomUUID(),idempotencyKey:randomUUID(),name:'Otro equipo'},directory)
    expect(state.templates.filter(t=>t.isDefault)).toHaveLength(1)
    expect(()=>saveTeam(state,{...template,periodStart:'2026-09-14'},directory)).toThrow()
    const batch=saveWeekly(state,input,directory,new Set(),principal);batch.lines[0].baseCost='200'
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
    await store.transactWeekly(state=>saveWeekly(state,input,directory,new Set(),principal))
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
    expect(workbook.getWorksheet('Nóminas semanales')?.getCell('H5').value).toBe(2400.7)
    expect(workbook.getWorksheet('Movimientos')?.rowCount).toBe(5)
    expect(workbook.getWorksheet('Movimientos')?.getCell('D5').value).toBe(2400.7)
    expect(workbook.getWorksheet('Eventos')?.getCell('J5').value).toBe(300.2)
    await app.close()
  })
})
