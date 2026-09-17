import 'dotenv/config'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { OAuth2Client } from 'google-auth-library'
import fastifyStatic from '@fastify/static'
import { buildApp } from './app.js'
import { sessionAuthenticator } from './auth.js'
import { PersistentDevelopmentStore } from './persistent-store.js'
import { registerDesktopGoogleRoutes } from './desktop-google.js'

declare const __GOOGLE_DESKTOP_CLIENT_ID__: string

function requiredEnvironment(name: 'SPL_DATA_DIR' | 'SPL_FRONTEND_DIR') {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const dataDirectory = requiredEnvironment('SPL_DATA_DIR')
const frontendDirectory = requiredEnvironment('SPL_FRONTEND_DIR')
const parentProcessId = Number(process.env.SPL_PARENT_PID)

const clientId = process.env.GOOGLE_CLIENT_ID ?? '920421552012-ice9btjftpdd86juf31gfho3qjnc6gfm.apps.googleusercontent.com'
process.env.ADMIN_EMAIL ??= 'omendivilg@gmail.com'
process.env.GOOGLE_ALLOWED_EMAILS ??= process.env.ADMIN_EMAIL
process.env.SPL_DESKTOP = '1'
process.env.SPL_ALLOW_TEST_LOGIN ??= '1'

const googleClient = new OAuth2Client(clientId)
const verifyGoogle = async (credential: string) => {
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId })
  const payload = ticket.getPayload()
  return payload?.email && payload.name ? { email: payload.email, name: payload.name, emailVerified: payload.email_verified === true } : null
}

async function main() {
  if (!Number.isSafeInteger(parentProcessId) || parentProcessId <= 0) throw new Error('SPL_PARENT_PID must be a positive integer')
  const store = await PersistentDevelopmentStore.open(resolve(dataDirectory, 'spl-data.json'))
  const app = buildApp(store, sessionAuthenticator(store), store, verifyGoogle, store)
  const port = Number(process.env.PORT ?? 3001)
  const desktopClientId = process.env.GOOGLE_DESKTOP_CLIENT_ID ?? __GOOGLE_DESKTOP_CLIENT_ID__
  registerDesktopGoogleRoutes(app, {
    store,
    clientId: desktopClientId,
    redirectBase: `http://127.0.0.1:${port}`,
    openExternal: url => {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'accounts.google.com') throw new Error('URL de autenticación inválida')
      spawn('explorer.exe', [url], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    },
  })
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Content-Security-Policy', "default-src 'self'; connect-src 'self' https://accounts.google.com; script-src 'self' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com; img-src 'self' data: https://*.googleusercontent.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com")
    return payload
  })
  await app.register(fastifyStatic, { root: resolve(frontendDirectory), wildcard: false })
  app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: 'Ruta no encontrada' }) : reply.sendFile('index.html'))

  await app.listen({ host: '127.0.0.1', port })
  console.log(`SPL desktop backend ready on http://127.0.0.1:${port}`)
  const parentMonitor = setInterval(() => {
    try { process.kill(parentProcessId, 0) }
    catch { void app.close().finally(() => process.exit(0)) }
  }, 2000)
  parentMonitor.unref()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void app.close().finally(() => process.exit(0)))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
