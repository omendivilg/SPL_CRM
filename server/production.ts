import { extname, resolve } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

export async function registerProductionWeb(app: FastifyInstance, googleClientId?: string, frontendDirectory = resolve('dist')) {
  app.get('/api/auth/google/config', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { data: { clientId: googleClientId ?? null } }
  })
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    reply.header('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; connect-src 'self' https://accounts.google.com; script-src 'self' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com; img-src 'self' data: https://*.googleusercontent.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style; font-src 'self' https://fonts.gstatic.com")
    return payload
  })
  await app.register(fastifyStatic, { root: frontendDirectory, wildcard: false })
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0]
    const navigation = (request.method === 'GET' || request.method === 'HEAD') && request.headers.accept?.includes('text/html')
    if (navigation && path !== '/api' && !path.startsWith('/api/') && !extname(path)) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html')
    }
    return reply.code(404).send({ error: 'Ruta no encontrada' })
  })
}
