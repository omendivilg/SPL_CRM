import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Read-only cloud check. Never submit Google credentials or business mutations.
const cloud = 'https://spl-crm.fly.dev'
const directory = await mkdtemp(join(tmpdir(), 'spl-desktop-cloud-'))
const sentinel = '{"qa":"existing-local-data-must-remain-unchanged"}\n'
let child
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill()
  await exited
  child = undefined
}
async function start() {
  const probe = createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, [resolve('desktop-backend-dist/spl-backend.cjs')], {
    windowsHide: true,
    env: { ...process.env, SPL_API_URL: cloud, SPL_DATA_DIR: directory,
      SPL_FRONTEND_DIR: resolve('dist'), SPL_PARENT_PID: String(process.pid),
      PORT: String(port), NODE_ENV: 'production', SPL_ALLOW_TEST_LOGIN: '1' },
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  child.on('error', () => {})
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Bundled cloud backend exited before readiness')
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(20_000) })
      if (response.ok) return base
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Bundled cloud backend did not become ready')
}
async function check(base) {
  const request = (path, options = {}) => fetch(`${base}${path}`, {
    ...options, signal: AbortSignal.timeout(20_000), redirect: 'error',
  })
  assert.equal((await request('/')).status, 200, 'Bundled frontend must be served')
  assert.equal((await request('/api/auth/me')).status, 401, 'Cloud must reject unauthenticated session')
  const disabled = await request('/api/auth/test-login/config')
  assert.deepEqual(await disabled.json(), { data: { enabled: false } })
  assert.equal((await request('/api/auth/test-login', { method: 'POST' })).status, 404,
    'Even inherited test-login flag must not enable cloud bypass')
  const config = await request('/api/auth/google/desktop/config')
  assert.equal((await config.json()).data.enabled, true, 'Desktop OAuth must be configured in bundle')
  const started = await request('/api/auth/google/desktop/start', { method: 'POST' })
  assert.equal(started.status, 200)
  const { data } = await started.json()
  const authorization = new URL(data.authorizationUrl)
  assert.equal(authorization.origin, 'https://accounts.google.com')
  assert.equal(authorization.pathname, '/o/oauth2/v2/auth')
  assert.equal(authorization.searchParams.get('response_type'), 'code')
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
  assert.match(authorization.searchParams.get('state'), /^[A-Za-z0-9_-]{43}$/)
  assert.match(authorization.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/)
  assert.equal(authorization.searchParams.get('redirect_uri'), `${base}/api/auth/google/desktop/callback`)
  assert.ok(authorization.searchParams.get('client_id').endsWith('.apps.googleusercontent.com'))
  assert.equal(authorization.searchParams.has('client_secret'), false)
  const pending = await request(`/api/auth/google/desktop/status?flowId=${encodeURIComponent(data.flowId)}`)
  assert.equal(pending.status, 202)
  assert.deepEqual(await pending.json(), { data: { status: 'pending' } })
}
try {
  const health = await fetch(`${cloud}/health`, { signal: AbortSignal.timeout(20_000), redirect: 'error' })
  assert.equal(health.status, 200, 'Actual Fly health must respond')
  assert.equal((await health.json()).status, 'ok')
  await check(await start())
  await stop()
  assert.deepEqual(await readdir(directory), [], 'Cloud mode must not create local data')
  await writeFile(join(directory, 'spl-data.json'), sentinel)
  await check(await start())
  await stop()
  assert.equal(await readFile(join(directory, 'spl-data.json'), 'utf8'), sentinel,
    'Cloud mode must leave existing JSON untouched')
  assert.deepEqual(await readdir(directory), ['spl-data.json'])
  console.log('PASS: bundled Windows cloud proxy, Fly read-only connection, auth boundaries, OAuth PKCE, restart, and local JSON preservation.')
} finally { await stop() }
