import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { DevelopmentStore } from './dev.js'
import { registerProductionWeb } from './production.js'

describe('central production web server', () => {
  it('serves the frontend while keeping API paths and missing assets out of the navigation fallback', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spl-production-'))
    const store = new DevelopmentStore()
    const app = buildApp(store, async () => null)
    try {
      await writeFile(join(directory, 'index.html'), '<html><div id="root"></div></html>')
      await registerProductionWeb(app, 'public-client.apps.googleusercontent.com', directory)
      const root = await app.inject('/')
      expect(root.statusCode).toBe(200)
      expect(root.headers['content-type']).toContain('text/html')
      expect(root.headers['content-security-policy']).toContain("object-src 'none'")
      expect(root.headers['content-security-policy']).toContain('https://accounts.google.com/gsi/style')
      expect(root.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups')
      expect(root.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
      expect((await app.inject({ url: '/finance', headers: { accept: 'text/html' } })).statusCode).toBe(200)
      expect((await app.inject({ url: '/assets/missing.js', headers: { accept: 'text/html' } })).statusCode).toBe(404)
      expect((await app.inject('/api/events')).statusCode).toBe(401)
      expect((await app.inject('/%61pi/events')).statusCode).toBe(401)
      expect((await app.inject('/api/events?limit=1')).statusCode).toBe(401)
      const config = await app.inject('/api/auth/google/config')
      expect(config.json()).toEqual({ data: { clientId: 'public-client.apps.googleusercontent.com' } })
      expect(config.headers['cache-control']).toBe('no-store')
      expect((await app.inject('/api/auth/google/config?refresh=1')).json()).toEqual(config.json())
    } finally { await app.close(); await rm(directory, { recursive: true, force: true }) }
  })

  it('reports dependency outages without exposing connection errors and recovers on the next health check', async () => {
    const store = new DevelopmentStore()
    let available = false
    const app = buildApp(store, async () => null, undefined, undefined, undefined, undefined, {
      checkHealth: async () => { if (!available) throw new Error('private database connection detail') },
    })
    try {
      const outage = await app.inject('/health')
      expect(outage.statusCode).toBe(503)
      expect(outage.json()).toEqual({ status: 'unavailable' })
      expect(outage.headers['cache-control']).toBe('no-store')
      available = true
      expect((await app.inject('/health')).json()).toEqual({ status: 'ok' })
    } finally { await app.close() }
  })
})
