import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'

const directory = await mkdtemp(join(tmpdir(), 'spl-desktop-payroll-'))
const probe = createServer()
probe.listen(0, '127.0.0.1')
await once(probe, 'listening')
const port = probe.address().port
await new Promise(resolve => probe.close(resolve))
const base = `http://127.0.0.1:${port}`
let child, cookie = '', output = ''
async function start() {
  output = ''
  child = spawn(process.execPath, [resolve('desktop-backend-dist/spl-backend.cjs')], {
    windowsHide: true,
    env: { ...process.env, SPL_DATA_DIR: directory, SPL_FRONTEND_DIR: resolve('dist'), SPL_PARENT_PID: String(process.pid), PORT: String(port), SPL_ALLOW_TEST_LOGIN: '1', ADMIN_EMAIL: 'packaged-test@spl.test', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', data => { output += data.toString() })
  child.stderr.on('data', data => { output += data.toString() })
  for (let attempt=0;attempt<100;attempt++) {
    if (child.exitCode !== null) throw new Error(`Bundled backend exited: ${output}`)
    try { if ((await fetch(`${base}/health`)).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Bundled backend did not start: ${output}`)
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const stopped = once(child, 'exit');child.kill();await stopped
}
async function api(path, method='GET', body) {
  const response=await fetch(`${base}${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})})
  for(const value of response.headers.getSetCookie()) cookie=value.split(';')[0]
  const data=await response.json()
  assert.equal(response.ok,true,JSON.stringify(data))
  return data.data
}
try {
  await start()
  await api('/api/auth/test-login','POST')
  const worker=await api('/api/workers','POST',{name:'Prueba de nómina empaquetada'})
  const id=randomUUID()
  const saved=await api(`/api/weekly-payroll/${id}`,'PUT',{
    version:0,idempotencyKey:randomUUID(),periodStart:'2026-09-14',periodEnd:'2026-09-20',
    lines:[{id:randomUUID(),employeeId:worker.id,baseCost:'1000.10',additions:'100.20',deductions:'50.05',allocations:[{scope:'warehouse',amount:'1100.30'}]}],
    expenses:[{id:randomUUID(),concept:'Transporte',amount:'100.10',notes:'',scope:'warehouse'}],
  })
  assert.equal(saved.total,'1150.35');assert.equal(saved.status,'unpaid')
  const payment={version:saved.version,idempotencyKey:randomUUID(),paymentDate:'2026-09-20'}
  await api(`/api/weekly-payroll/${id}/pay`,'POST',payment)
  await api(`/api/weekly-payroll/${id}/pay`,'POST',payment)
  await stop();await start()
  const records=await api('/api/weekly-payroll')
  assert.equal(records.length,1);assert.equal(records[0].status,'paid');assert.equal(records[0].payments.length,1);assert.equal(records[0].payments[0].amount,'1150.35')
  console.log('Bundled desktop backend: payroll save, full payment, retry and restart persistence passed. Isolated test data:', directory)
} finally { await stop() }
