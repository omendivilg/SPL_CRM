import 'dotenv/config'
import { Pool } from 'pg'
import { OAuth2Client } from 'google-auth-library'
import { buildApp } from './app.js'
import { sessionAuthenticator } from './auth.js'
import { PostgresEventRepository } from './repository.js'
import { PostgresSessionStore } from './sessions.js'
import {PostgresPayrollStore} from './payroll.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const pool = new Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined })
const sessions=new PostgresSessionStore(pool)
const googleClientId=process.env.GOOGLE_CLIENT_ID
const googleClient=googleClientId?new OAuth2Client(googleClientId):null
const verifyGoogle=googleClient&&googleClientId?async(credential:string)=>{const ticket=await googleClient.verifyIdToken({idToken:credential,audience:googleClientId});const payload=ticket.getPayload();return payload?.email&&payload.name?{email:payload.email,name:payload.name,emailVerified:payload.email_verified===true}:null}:undefined
const app = buildApp(new PostgresEventRepository(pool), sessionAuthenticator(sessions),sessions,verifyGoogle,new PostgresPayrollStore(pool))
const port = Number(process.env.PORT ?? 3001)
await app.listen({ host: '127.0.0.1', port })
