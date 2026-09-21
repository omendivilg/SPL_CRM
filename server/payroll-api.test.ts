import {beforeEach,describe,expect,it} from 'vitest'
import {buildApp} from './app.js'
import {DevelopmentStore} from './dev.js'
const owner={userId:'owner',role:'owner' as const,unit:null}
describe('payroll directory and retired endpoints',()=>{
  let store:DevelopmentStore
  beforeEach(()=>{store=new DevelopmentStore()})
  it('protects directories and legacy records and removes all old mutation endpoints',async()=>{
    const app=buildApp(store,async request=>request.headers.authorization==='coordinator'?{...owner,role:'coordinator',unit:'SPL'}:owner,undefined,undefined,store,store)
    for(const url of ['/api/payroll','/api/workers','/api/weekly-payroll','/api/team-templates','/api/weekly-payroll/legacy']) expect((await app.inject({url,headers:{authorization:'coordinator'}})).statusCode).toBe(403)
    for(const url of ['/api/payroll','/api/payroll/old/settlements','/api/payroll-templates','/api/weekly-payroll/old/lines/old/pay']) expect((await app.inject({method:'POST',url,payload:{}})).statusCode).toBe(404)
    await app.close()
  })
  it('validates worker names, keeps hostile text inert and rejects duplicate names',async()=>{
    const app=buildApp(store,async()=>owner,undefined,undefined,store,store)
    for(const payload of [{name:''},{name:'x'.repeat(161)},{name:'Andrea',role:'owner'}]) expect((await app.inject({method:'POST',url:'/api/workers',payload})).statusCode).toBe(400)
    const name='<img src=x onerror=alert(1)>'
    expect((await app.inject({method:'POST',url:'/api/workers',payload:{name}})).json().data.name).toBe(name)
    expect((await app.inject({method:'POST',url:'/api/workers',payload:{name}})).statusCode).toBe(409)
    await app.close()
  })
  it('exports valid workbooks for financial roles only',async()=>{
    const app=buildApp(store,async request=>request.headers.authorization==='coordinator'?{...owner,role:'coordinator',unit:'SPL'}:owner,undefined,undefined,store,store)
    const report=await app.inject('/api/reports/monthly.xlsx?month=2026-09');expect(report.statusCode).toBe(200);expect(report.rawPayload.subarray(0,2).toString()).toBe('PK')
    expect((await app.inject({url:'/api/reports/monthly.xlsx?month=2026-09',headers:{authorization:'coordinator'}})).statusCode).toBe(403)
    expect((await app.inject('/api/reports/monthly.xlsx?month=2026-13')).statusCode).toBe(400)
    await app.close()
  })
})
