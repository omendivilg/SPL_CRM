import 'dotenv/config'
import { Pool } from 'pg'
import { OAuth2Client } from 'google-auth-library'
import { buildApp } from './app.js'
import { sessionAuthenticator } from './auth.js'
import { PostgresEventRepository } from './repository.js'
import { PostgresSessionStore } from './sessions.js'
import {PostgresPayrollStore} from './payroll.js'
import {PostgresWeeklyStore} from './postgres-weekly.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const pool = new Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined, max:Number(process.env.PG_POOL_MAX??5),idleTimeoutMillis:30_000,connectionTimeoutMillis:10_000 })
const sessions=new PostgresSessionStore(pool)
const googleClientId=process.env.GOOGLE_CLIENT_ID
const googleClient=googleClientId?new OAuth2Client(googleClientId):null
const googleAudiences=[googleClientId,process.env.GOOGLE_IOS_CLIENT_ID].filter((value):value is string=>Boolean(value))
const verifyGoogle=googleClient&&googleAudiences.length?async(credential:string)=>{const ticket=await googleClient.verifyIdToken({idToken:credential,audience:googleAudiences});const payload=ticket.getPayload();return payload?.email&&payload.name?{email:payload.email,name:payload.name,emailVerified:payload.email_verified===true}:null}:undefined
const payroll = new PostgresPayrollStore(pool)
const app = buildApp(new PostgresEventRepository(pool), sessionAuthenticator(sessions),sessions,verifyGoogle,payroll,new PostgresWeeklyStore(pool))
const port = Number(process.env.PORT ?? 3001)
await app.listen({ host: process.env.HOST??'127.0.0.1', port })
