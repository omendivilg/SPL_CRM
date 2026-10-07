import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'

// Every database, session, and credential used here is disposable test data.
const image = process.argv[2] ?? 'spl-readiness:local'
const suffix = randomUUID().slice(0, 8)
const network = `spl-smoke-${suffix}`
const database = `${network}-db`
const container = `${network}-app`
const databaseUrl = `postgresql://smoke:smoke-local-only@${database}:5432/smoke`
const clientId = 'docker-smoke.apps.googleusercontent.com'
await mkdir('outputs', { recursive: true })
const tls = await mkdtemp(join(resolve('outputs'), 'docker-smoke-'))
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const environment = ['-e', `DATABASE_URL=${databaseUrl}`, '-e', 'NODE_EXTRA_CA_CERTS=/tls/server.crt']
const mount = ['--mount', `type=bind,source=${tls},target=/tls,readonly`]
const failures = []
async function check(name, operation) {
  try { await operation(); console.log(`PASS ${name}`) }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`) }
}
async function waitUntil(operation, description) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try { if (await operation()) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${description}`)
}
let browser
try {
  docker('network', 'create', network)
  docker('run', '--rm', '--user', 'root', '--mount', `type=bind,source=${tls},target=/tls`, '--entrypoint', 'openssl', image,
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', '/tls/server.key', '-out', '/tls/server.crt', '-days', '1', '-subj', `/CN=${database}`, '-addext', `subjectAltName=DNS:${database}`)
  docker('run', '-d', '--name', database, '--network', network, ...mount, '-e', 'POSTGRES_USER=smoke', '-e', 'POSTGRES_PASSWORD=smoke-local-only', '-e', 'POSTGRES_DB=smoke', '--entrypoint', 'sh', 'postgres:18-bookworm', '-c',
    'cp /tls/server.key /tmp/smoke.key && cp /tls/server.crt /tmp/smoke.crt && chown postgres:postgres /tmp/smoke.key /tmp/smoke.crt && chmod 600 /tmp/smoke.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/smoke.crt -c ssl_key_file=/tmp/smoke.key')
  await waitUntil(() => { docker('exec', database, 'pg_isready', '-U', 'smoke', '-d', 'smoke'); return true }, 'PostgreSQL')
  docker('run', '--rm', '--network', network, ...mount, ...environment, image, 'node', 'build-server/scripts/migrate.js')
  // Running migrations twice must be safe.
  docker('run', '--rm', '--network', network, ...mount, ...environment, image, 'node', 'build-server/scripts/migrate.js')
  docker('run', '-d', '--name', container, '--network', network, '-p', '127.0.0.1::3001', ...mount, ...environment,
    '-e', `GOOGLE_CLIENT_ID=${clientId}`, '-e', 'ADMIN_EMAIL=smoke@example.invalid', '-e', 'GOOGLE_ALLOWED_EMAILS=smoke@example.invalid', '-e', 'SPL_ALLOW_TEST_LOGIN=1', image)
  const port = docker('port', container, '3001/tcp').split(':').at(-1)
  const base = `http://127.0.0.1:${port}`
  const request = (path, options) => fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(5_000) })
  await waitUntil(async () => (await request('/health')).status === 200, 'production startup')
  await check('Docker health command', () => {
    const healthcheck = JSON.parse(docker('inspect', container, '--format', '{{json .Config.Healthcheck.Test}}'))
    assert.equal(healthcheck[0], 'CMD-SHELL')
    docker('exec', container, 'sh', '-c', healthcheck[1])
  })
  await check('frontend and navigation fallback', async () => {
    const root = await request('/')
    assert.equal(root.status, 200)
    assert.match(root.headers.get('content-type'), /text\/html/)
    assert.match(await root.text(), /<div id="app">/)
    assert.match(root.headers.get('content-security-policy'), /object-src 'none'/)
    assert.equal(root.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups')
    assert.equal(root.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
    assert.equal((await request('/finance', { headers: { accept: 'text/html' } })).status, 200)
    assert.equal((await request('/assets/missing.js', { headers: { accept: 'text/html' } })).status, 404)
  })
  await check('authentication boundaries and runtime Google configuration', async () => {
    assert.equal((await request('/api/events')).status, 401)
    assert.equal((await request('/api/auth/test-login', { method: 'POST' })).status, 404)
    const config = await request('/api/auth/google/config')
    assert.equal(config.status, 200)
    assert.deepEqual(await config.json(), { data: { clientId } })
  })
  await check('Google button uses runtime configuration in the production browser', async () => {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    // Only the external Google SDK is stubbed; the image, frontend, and API are real.
    await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'application/javascript', body:
      `const style=document.createElement('link');style.rel='stylesheet';style.href='https://accounts.google.com/gsi/style';style.onload=()=>window.smokeGoogleStylesLoaded=true;document.head.appendChild(style);window.google={accounts:{id:{initialize:options=>window.smokeGoogleClientId=options.client_id,renderButton:(element,options)=>{const button=document.createElement('button');button.textContent='Continuar con Google';button.style.width=options.width+'px';element.appendChild(button)}}}};` }))
    await page.route('https://accounts.google.com/gsi/style', route => route.fulfill({ contentType: 'text/css', body: '.google-button button { min-height: 40px; }' }))
    await page.goto(base)
    await page.getByRole('button', { name: 'Continuar con Google', exact: true }).waitFor()
    await page.waitForFunction(() => window.smokeGoogleStylesLoaded === true)
    assert.equal(await page.evaluate(() => window.smokeGoogleClientId), clientId)
    assert.equal(await page.getByText('No se pudo verificar Google para Windows.', { exact: false }).count(), 0)
    await page.screenshot({ path: 'outputs/docker-login-desktop.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'outputs/docker-login-phone.png' })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
  })
  await check('authenticated writes persist in real PostgreSQL and dump/restore works', async () => {
    const token = docker('exec', container, 'node', '--input-type=module', '-e', `
      import {Pool} from 'pg';
      import {PostgresSessionStore,newSessionToken,hashSessionToken} from './build-server/server/sessions.js';
      const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true}});
      try{const store=new PostgresSessionStore(pool),user=await store.findOrCreateGoogleUser('smoke@example.invalid','Smoke','admin',null);
      const token=newSessionToken();await store.createSession(user.id,hashSessionToken(token),new Date(Date.now()+60000));console.log(token);}finally{await pool.end();}`)
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const created = await request('/api/events', { method: 'POST', headers, body: JSON.stringify({ businessUnit: 'SPL', clientName: 'Docker smoke', venue: 'Test venue', eventDate: '2026-10-05', agreedPrice: '100.00' }) })
    assert.equal(created.status, 201)
    const id = (await created.json()).data.id
    const events = await (await request('/api/events', { headers })).json()
    assert.ok(events.data.some(event => event.id === id))
    docker('exec', container, 'pg_dump', '--format=custom', '--no-owner', '--no-privileges', '--file=/tmp/smoke.dump', databaseUrl)
    docker('exec', database, 'createdb', '-U', 'smoke', 'restored')
    docker('exec', container, 'pg_restore', '--no-owner', '--no-privileges', '--dbname', databaseUrl.replace(/\/smoke$/, '/restored'), '/tmp/smoke.dump')
    assert.equal(docker('exec', database, 'psql', '-U', 'smoke', '-d', 'restored', '-tAc', 'SELECT count(*) FROM events').trim(), '1')
  })
  await check('image runs without root and excludes environment files', () => {
    const result = JSON.parse(docker('exec', container, 'node', '-e', `const fs=require('fs');console.log(JSON.stringify({uid:process.getuid(),env:fs.readdirSync('/app').filter(name=>name.startsWith('.env'))}));`))
    assert.notEqual(result.uid, 0)
    assert.deepEqual(result.env, [])
  })
  await check('database outage reports 503 and recovers without restarting the API', async () => {
    docker('stop', '--timeout', '5', database)
    await waitUntil(async () => (await request('/health')).status === 503, 'unhealthy response')
    assert.equal(docker('inspect', container, '--format', '{{.State.Running}}'), 'true')
  })
  docker('start', database)
  await check('database reconnection', async () => {
    await waitUntil(async () => (await request('/health')).status === 200, 'database recovery')
  })
  await check('SIGTERM drains and exits successfully', () => {
    docker('stop', '--timeout', '12', container)
    assert.equal(docker('inspect', container, '--format', '{{.State.ExitCode}}'), '0')
  })
} finally {
  await browser?.close()
  for (const name of [container, database]) { try { docker('rm', '-f', '-v', name) } catch {} }
  try { docker('network', 'rm', network) } catch {}
  await rm(tls, { recursive: true, force: true })
}
if (failures.length) { console.error(`${failures.length} Docker checks failed`); process.exitCode = 1 }
else console.log('All production Docker checks passed')
