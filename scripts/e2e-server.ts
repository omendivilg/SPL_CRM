import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import fastifyStatic from '@fastify/static'
import { PersistentDevelopmentStore } from '../server/persistent-store.js'
import { buildApp } from '../server/app.js'
import { sessionAuthenticator } from '../server/auth.js'

process.env.SPL_ALLOW_TEST_LOGIN = '1'
process.env.ADMIN_EMAIL = 'acceptance@spl.test'
const directory = process.env.SPL_E2E_DATA ?? await mkdtemp(join(tmpdir(), 'spl-e2e-'))
const store = await PersistentDevelopmentStore.open(join(directory, 'data.json'))
const app = buildApp(store, sessionAuthenticator(store), store, undefined, store, store)
await app.register(fastifyStatic, { root: resolve('dist') })
await app.listen({ host: '127.0.0.1', port: Number(process.env.SPL_E2E_PORT ?? 4318) })
console.log('Acceptance server ready, isolated data:', directory)
