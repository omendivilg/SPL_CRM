import 'dotenv/config'
import { Pool } from 'pg'
import { OAuth2Client } from 'google-auth-library'
import { buildApp } from './app.js'
import { sessionAuthenticator } from './auth.js'
import { PostgresEventRepository } from './repository.js'
import { PostgresSessionStore } from './sessions.js'
import {PostgresPayrollStore} from './payroll.js'
import {PostgresWeeklyStore} from './postgres-weekly.js'
import { registerProductionWeb } from './production.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const pool = new Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined, max:Number(process.env.PG_POOL_MAX??5),idleTimeoutMillis:30_000,connectionTimeoutMillis:3_000 })
pool.on('error', () => console.error('PostgreSQL idle connection failed; the next request will reconnect.'))
const sessions=new PostgresSessionStore(pool)
const googleClientId=process.env.GOOGLE_CLIENT_ID
const googleClient=googleClientId?new OAuth2Client(googleClientId):null
const googleAudiences=[googleClientId,process.env.GOOGLE_IOS_CLIENT_ID,process.env.GOOGLE_DESKTOP_CLIENT_ID].filter((value):value is string=>Boolean(value))
const verifyGoogle=googleClient&&googleAudiences.length?async(credential:string)=>{const ticket=await googleClient.verifyIdToken({idToken:credential,audience:googleAudiences});const payload=ticket.getPayload();return payload?.email&&payload.name?{email:payload.email,name:payload.name,emailVerified:payload.email_verified===true}:null}:undefined
const payroll = new PostgresPayrollStore(pool)
const healthQuery = { text: 'SELECT 1', query_timeout: 3_000 }
const app = buildApp(new PostgresEventRepository(pool), sessionAuthenticator(sessions),sessions,verifyGoogle,payroll,new PostgresWeeklyStore(pool), {
  checkHealth: async () => { await pool.query(healthQuery) },
})
app.addHook('onClose', async () => { await pool.end() })
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    const deadline = setTimeout(() => process.exit(1), 10_000)
    deadline.unref()
    void app.close().then(() => process.exit(0), () => process.exit(1))
  })
}
const port = Number(process.env.PORT ?? 3001)
try {
  await registerProductionWeb(app, googleClientId)
  await app.listen({ host: process.env.HOST??'127.0.0.1', port })
} catch {
  console.error('Central server startup failed. Check database connectivity, migrations, and configuration.')
  await app.close()
  process.exitCode = 1
}
