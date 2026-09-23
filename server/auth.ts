import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Principal } from './domain.js'
import { hashPassword, verifyPassword } from './password.js'
import { hashSessionToken, newSessionToken, type SessionStore } from './sessions.js'
import type { Role } from './domain.js'

export type Authenticator = (request: FastifyRequest) => Promise<Principal | null>
export const SESSION_COOKIE='spl_session'
const SESSION_MS=180*24*60*60*1000
const loginSchema=z.object({email:z.email().max(320).transform(value=>value.toLowerCase()),password:z.string().min(8).max(128)}).strict()
let dummyHashPromise:Promise<string>|undefined
const dummyHash=()=>dummyHashPromise??=(hashPassword('not-a-real-user-password'))

export function sessionAuthenticator(store:SessionStore):Authenticator {
  return async request=>{const bearer=request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1],token=bearer??request.cookies?.[SESSION_COOKIE];if(!token||token.length>100)return null;const principal=await store.findPrincipal(hashSessionToken(token),new Date());return principal?{userId:principal.userId,role:principal.role,unit:principal.unit}:null}
}

type GoogleIdentity={email:string;name:string;emailVerified:boolean}
export type GoogleVerifier=(credential:string)=>Promise<GoogleIdentity|null>
const googleSchema=z.object({credential:z.string().min(100).max(10000)}).strict()
const sessionResponse=(user:{id:string;email:string;displayName:string;role:Role;businessUnit:import('./domain.js').BusinessUnit|null})=>({userId:user.id,email:user.email,displayName:user.displayName,role:user.role,unit:user.businessUnit})
const sessionCookieOptions=()=>({httpOnly:true as const,sameSite:'strict' as const,secure:process.env.NODE_ENV==='production'&&process.env.SPL_DESKTOP!=='1',path:'/',maxAge:SESSION_MS/1000})

export async function issueSession(reply:import('fastify').FastifyReply,store:SessionStore,user:{id:string;email:string;displayName:string;role:Role;businessUnit:import('./domain.js').BusinessUnit|null}) {
  const token=newSessionToken(),expiresAt=new Date(Date.now()+SESSION_MS)
  await store.createSession(user.id,hashSessionToken(token),expiresAt)
  reply.setCookie(SESSION_COOKIE,token,sessionCookieOptions())
  return sessionResponse(user)
}

export function registerAuthRoutes(app:FastifyInstance,store:SessionStore,verifyGoogle?:GoogleVerifier){
  const testLoginEnabled=process.env.SPL_ALLOW_TEST_LOGIN==='1'&&(process.env.SPL_DESKTOP==='1'||process.env.NODE_ENV!=='production')
  app.get('/api/auth/test-login/config',async()=>({data:{enabled:testLoginEnabled}}))
  app.post('/api/auth/test-login',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async(_request,reply)=>{
    if(!testLoginEnabled)return reply.code(404).send({error:'Ruta no encontrada'})
    const email=(process.env.ADMIN_EMAIL??'omendivilg@gmail.com').trim().toLowerCase()
    const user=await store.findOrCreateGoogleUser(email,'Oscar', 'admin',null)
    if(!user.active)return reply.code(403).send({error:'Esta cuenta no está autorizada'})
    return {data:await issueSession(reply,store,user)}
  })
  app.post('/api/auth/login',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(request,reply)=>{
    const input=loginSchema.parse(request.body)
    const user=await store.findUserByEmail(input.email)
    const valid=await verifyPassword(input.password,user?.passwordHash??await dummyHash())
    if(!user||!user.active||!valid)return reply.code(401).send({error:'Correo o contraseña incorrectos'})
    return {data:await issueSession(reply,store,user)}
  })
  app.post('/api/auth/google',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(request,reply)=>{
    if(!verifyGoogle)return reply.code(503).send({error:'Acceso con Google no configurado'})
    const {credential}=googleSchema.parse(request.body)
    const identity=await verifyGoogle(credential)
    if(!identity?.emailVerified)return reply.code(401).send({error:'No se pudo verificar la cuenta de Google'})
    const email=identity.email.trim().toLowerCase()
    const allowed=new Set((process.env.GOOGLE_ALLOWED_EMAILS??'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean))
    if(!allowed.has(email))return reply.code(403).send({error:'Esta cuenta no está autorizada'})
    const adminEmail=(process.env.ADMIN_EMAIL??'').trim().toLowerCase()
    const role:Role=email===adminEmail?'admin':'coordinator'
    const user=await store.findOrCreateGoogleUser(email,identity.name.slice(0,160),role,role==='coordinator'?'5to Elemento':null)
    if(!user.active)return reply.code(403).send({error:'Esta cuenta no está autorizada'})
    return {data:await issueSession(reply,store,user)}
  })
  app.post('/api/auth/google/native',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(request,reply)=>{
    if(!verifyGoogle)return reply.code(503).send({error:'Google no está configurado'})
    const {credential}=googleSchema.parse(request.body),identity=await verifyGoogle(credential)
    if(!identity?.emailVerified)return reply.code(401).send({error:'Identidad no verificada'})
    const email=identity.email.toLowerCase(),allowed=new Set((process.env.GOOGLE_ALLOWED_EMAILS??'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean))
    if(!allowed.has(email))return reply.code(403).send({error:'Cuenta no autorizada'})
    const adminEmail=(process.env.ADMIN_EMAIL??'').trim().toLowerCase(),role=email===adminEmail?'admin' as const:'coordinator' as const
    const user=await store.findOrCreateGoogleUser(email,identity.name,role,role==='coordinator'?'5to Elemento':null)
    if(!user.active)return reply.code(403).send({error:'Cuenta desactivada'})
    const token=newSessionToken(),expiresAt=new Date(Date.now()+SESSION_MS)
    await store.createSession(user.id,hashSessionToken(token),expiresAt)
    return {data:{user:sessionResponse(user),token,expiresAt:expiresAt.toISOString()}}
  })
  app.get('/api/auth/me',async(request)=>{const token=request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]??request.cookies[SESSION_COOKIE]??'';const principal=await store.findPrincipal(hashSessionToken(token),new Date());return {data:principal}})
  app.post('/api/auth/logout',async(request,reply)=>{const token=request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]??request.cookies[SESSION_COOKIE];if(token)await store.revokeSession(hashSessionToken(token));reply.clearCookie(SESSION_COOKIE,{path:'/'});return reply.code(204).send()})
}
