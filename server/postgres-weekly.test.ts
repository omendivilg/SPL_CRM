import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { newDb } from 'pg-mem'
import { describe, expect, it } from 'vitest'
import { PostgresWeeklyStore } from './postgres-weekly.js'
import { migrateWeekly, payWeekly, payrollProjection, saveWeekly } from './weekly.js'

async function setup() {
  const db=newDb()
  for(const filename of ['003_weekly_payroll.sql','005_payroll_full_payment.sql'])db.public.none(await readFile(new URL(`./db/migrations/${filename}`,import.meta.url),'utf8'))
  const {Pool}=db.adapters.createPg(),pool=new Pool()
  return {pool,store:new PostgresWeeklyStore(pool as never)}
}
const principal={userId:'owner',role:'owner' as const,unit:null}

describe('PostgreSQL weekly store contract',()=>{
  it('migrates once with a backup and persists exactly the same full-payment model',async()=>{
    const {pool,store}=await setup(),worker={id:randomUUID(),name:'Andrea',active:true}
    await pool.query('INSERT INTO weekly_payroll_state (id,state) VALUES (true,$1::jsonb)',[JSON.stringify({batches:[],templates:[],migrated:false})])
    await store.transactWeekly(state=>migrateWeekly(state,[],[],[worker],[]))
    expect((await pool.query('SELECT * FROM weekly_payroll_backups')).rows).toHaveLength(1)
    const input={id:randomUUID(),version:0,idempotencyKey:randomUUID(),periodStart:'2026-09-14',periodEnd:'2026-09-20',lines:[{id:randomUUID(),employeeId:worker.id,baseCost:'100.10',additions:'0.20',deductions:'0.05',allocations:[{scope:'warehouse',amount:'100.30'}]}],expenses:[{id:randomUUID(),concept:'Alimentos',amount:'25.10',notes:'',scope:'warehouse'}]}
    await store.transactWeekly(state=>saveWeekly(state,input,[worker],new Set(),principal))
    const paid=await store.transactWeekly(state=>payWeekly(state,input.id,{version:1,paymentDate:'2026-09-20',idempotencyKey:randomUUID()},principal))
    expect(paid).toMatchObject({status:'paid',total:'125.35'});expect(paid.payments).toHaveLength(1)
    const reopened=new PostgresWeeklyStore(pool as never)
    expect((await reopened.readWeekly()).batches[0]).toEqual(paid)
    expect(payrollProjection(await reopened.readWeekly())[0]).toMatchObject({laborCost:'100.30',netPay:'100.25',paidAmount:'100.25'})
    await expect(store.transactWeekly(state=>saveWeekly(state,{...input,version:paid.version,idempotencyKey:randomUUID()},[worker],new Set(),principal))).rejects.toThrow('solo lectura')
    expect((await reopened.readWeekly()).batches[0]).toEqual(paid)
    await pool.end()
  })
})
