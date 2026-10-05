import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { newDb } from 'pg-mem'
import { describe, expect, it } from 'vitest'
import { PostgresWeeklyStore } from './postgres-weekly.js'
import { emptyWeekly, migrateWeekly, payWeekly, payrollProjection, saveWeekly } from './weekly.js'
import { receiveDirectIncome, saveDirectIncome } from './direct-income.js'

async function setup() {
  const db=newDb()
  for(const filename of ['003_weekly_payroll.sql','005_payroll_full_payment.sql'])db.public.none(await readFile(new URL(`./db/migrations/${filename}`,import.meta.url),'utf8'))
  const {Pool}=db.adapters.createPg(),pool=new Pool()
  return {pool,store:new PostgresWeeklyStore(pool as never)}
}
const principal={userId:'owner',role:'owner' as const,unit:null}

describe('PostgreSQL weekly store contract',()=>{
  it('normalizes version-two data on read and saves a backed-up version-three state',async()=>{
    const {pool,store}=await setup()
    const old={schemaVersion:2,batches:[],templates:[],quickExpenses:[{id:randomUUID(),name:'Gasolina',category:'Transporte',amount:'20.00',expenseDate:'2026-09-22',businessUnit:'SPL consolidado',createdBy:'owner',createdAt:'2026-09-22T00:00:00Z'}],migrated:true,legacy:[],legacySettlements:[],importedWorkers:[],archive:[]}
    await pool.query('INSERT INTO weekly_payroll_state (id,state) VALUES (true,$1::jsonb)',[JSON.stringify(old)])
    expect((await store.readWeekly()).quickExpenses[0].businessUnit).toBe('SPL')
    await store.transactWeekly(state=>state.quickExpenses.length)
    expect((await pool.query('SELECT state FROM weekly_payroll_state')).rows[0].state.schemaVersion).toBe(3)
    expect((await pool.query("SELECT state FROM weekly_payroll_backups WHERE name='before-payroll-v3'")).rows[0].state.quickExpenses[0].businessUnit).toBe('SPL consolidado')
    await pool.end()
  })
  it('migrates once with a backup and persists exactly the same full-payment model',async()=>{
    const {pool,store}=await setup(),worker={id:randomUUID(),name:'Andrea',active:true}
    await pool.query('INSERT INTO weekly_payroll_state (id,state) VALUES (true,$1::jsonb)',[JSON.stringify({batches:[],templates:[],migrated:false})])
    await store.transactWeekly(state=>migrateWeekly(state,[],[],[worker],[]))
    expect((await pool.query('SELECT * FROM weekly_payroll_backups')).rows).toHaveLength(1)
    const input={id:randomUUID(),version:0,idempotencyKey:randomUUID(),businessUnit:'SPL' as const,periodStart:'2026-09-14',periodEnd:'2026-09-20',lines:[{id:randomUUID(),employeeId:worker.id,baseCost:'100.10',additions:'0.20',deductions:'0.05',allocations:[{scope:'warehouse',amount:'100.30'}]}],expenses:[{id:randomUUID(),concept:'Alimentos',category:'Alimentos',amount:'25.10',notes:'',scope:'warehouse'}]}
    await store.transactWeekly(state=>saveWeekly(state,input,[worker],new Map(),principal))
    const paid=await store.transactWeekly(state=>payWeekly(state,input.id,{version:1,paymentDate:'2026-09-20',idempotencyKey:randomUUID()},principal))
    expect(paid).toMatchObject({status:'paid',total:'125.35'});expect(paid.payments).toHaveLength(1)
    const reopened=new PostgresWeeklyStore(pool as never)
    expect((await reopened.readWeekly()).batches[0]).toEqual(paid)
    expect(payrollProjection(await reopened.readWeekly())[0]).toMatchObject({laborCost:'100.30',netPay:'100.25',paidAmount:'100.25'})
    await expect(store.transactWeekly(state=>saveWeekly(state,{...input,version:paid.version,idempotencyKey:randomUUID()},[worker],new Map(),principal))).rejects.toThrow('solo lectura')
    expect((await reopened.readWeekly()).batches[0]).toEqual(paid)
    await pool.end()
  })

  it('persists income notes and creation audit without a schema change or losing legacy incomes',async()=>{
    const {pool,store}=await setup(),id=randomUUID(),legacyId=randomUUID()
    const input={name:'Renta de equipo',amount:'125.50',expectedDate:'2026-09-30',businessUnit:'SPL' as const,notes:'  Comprobante recibido\nPago en oficina  '}
    const old=emptyWeekly()
    old.directIncomes.push({...input,id:legacyId,notes:undefined,receivedDate:null,version:1,createdBy:'owner',createdAt:'2026-09-01T00:00:00Z'})
    await pool.query('INSERT INTO weekly_payroll_state (id,state) VALUES (true,$1::jsonb)',[JSON.stringify(old)])
    await store.transactWeekly(state=>saveDirectIncome(state,id,input,principal))
    await store.transactWeekly(state=>receiveDirectIncome(state,id,{receivedDate:'2026-10-02',version:1},principal))
    const reopened=new PostgresWeeklyStore(pool as never),state=await reopened.readWeekly()
    expect(state.schemaVersion).toBe(3)
    expect(state.directIncomes.find(item=>item.id===id)).toMatchObject({notes:'Comprobante recibido\nPago en oficina',receivedDate:'2026-10-02',version:2})
    expect(state.directIncomes.find(item=>item.id===legacyId)).not.toHaveProperty('notes')
    expect(state.directIncomeAudit.map(item=>item.after.notes)).toEqual(['Comprobante recibido\nPago en oficina','Comprobante recibido\nPago en oficina'])
    expect(state.directIncomeAudit[0].after.receivedDate).toBeNull()
    expect((await pool.query('SELECT * FROM weekly_payroll_backups')).rows).toHaveLength(0)
    await reopened.transactWeekly(next=>saveDirectIncome(next,id,input,principal))
    await reopened.transactWeekly(next=>saveDirectIncome(next,legacyId,{...input,notes:null},principal))
    expect((await reopened.readWeekly()).directIncomes).toHaveLength(2)
    await expect(reopened.transactWeekly(next=>saveDirectIncome(next,id,{...input,notes:'Otra nota'},principal))).rejects.toThrow('datos diferentes')
    expect((await reopened.readWeekly()).directIncomes.find(item=>item.id===id)?.notes).toBe('Comprobante recibido\nPago en oficina')
    await pool.end()
  })
})
