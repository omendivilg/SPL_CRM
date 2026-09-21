import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { issueSession } from './auth.js'
import type { SessionStore, LoginUser } from './sessions.js'

const callbackSchema=z.union([
  z.object({code:z.string().min(10).max(4096),state:z.string().length(43)}).strict(),
  z.object({error:z.string().min(1).max(100),state:z.string().length(43)}).strict(),
])
const statusSchema=z.object({flowId:z.uuid()}).strict()
const tokenSchema=z.object({access_token:z.string().min(20).max(8192)})
const identitySchema=z.object({email:z.email().max(320),name:z.string().min(1).max(160),email_verified:z.boolean()})
type Flow={state:string;verifier:string;expiresAt:number;status:'pending'|'complete'|'error';user?:LoginUser}

export function registerDesktopGoogleRoutes(app:FastifyInstance,options:{store:SessionStore;clientId?:string;redirectBase:string;openExternal:(url:string)=>void|Promise<void>;fetcher?:typeof fetch}) {
  const flows=new Map<string,Flow>(),fetcher=options.fetcher??fetch
  const cleanup=()=>{const now=Date.now();for(const [id,flow] of flows)if(flow.expiresAt<=now)flows.delete(id)}
  app.get('/api/auth/google/desktop/config',async()=>({data:{enabled:Boolean(options.clientId)}}))
  app.post('/api/auth/google/desktop/start',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(_request,reply)=>{
    if(!options.clientId)return reply.code(503).send({error:'Se requiere un cliente OAuth de escritorio'})
    cleanup();if(flows.size>=20)return reply.code(429).send({error:'Demasiados intentos pendientes'})
    const flowId=randomUUID(),state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url')
    flows.set(flowId,{state,verifier,expiresAt:Date.now()+5*60_000,status:'pending'})
    const redirectUri=`${options.redirectBase}/api/auth/google/desktop/callback`
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search=new URLSearchParams({client_id:options.clientId,redirect_uri:redirectUri,response_type:'code',scope:'openid email profile',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'}).toString()
    try { await options.openExternal(url.toString()) }
    catch {
      flows.delete(flowId)
      return reply.code(503).send({ error: 'No se pudo abrir el navegador. Inténtalo nuevamente.' })
    }
    return {data:{flowId}}
  })
  app.get('/api/auth/google/desktop/callback',async(request,reply)=>{
    if(!options.clientId)return reply.code(503).type('text/plain').send('Google no está configurado')
    const input=callbackSchema.parse(request.query),entry=[...flows].find(([,flow])=>flow.state===input.state)
    if(!entry||entry[1].expiresAt<=Date.now())return reply.code(400).type('text/plain').send('Solicitud vencida o inválida')
    const [flowId,flow]=entry,redirectUri=`${options.redirectBase}/api/auth/google/desktop/callback`
    if('error' in input){flow.status='error';flows.set(flowId,flow);return reply.code(400).type('text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><title>SPL</title><p>El acceso fue cancelado. Puedes cerrar esta ventana y volver a SPL.</p>')}
    try{
      const tokenResponse=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:options.clientId,code:input.code,code_verifier:flow.verifier,grant_type:'authorization_code',redirect_uri:redirectUri})})
      if(!tokenResponse.ok)throw new Error('token exchange rejected')
      const token=tokenSchema.parse(await tokenResponse.json())
      const identityResponse=await fetcher('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:`Bearer ${token.access_token}`}})
      if(!identityResponse.ok)throw new Error('identity rejected')
      const identity=identitySchema.parse(await identityResponse.json()),email=identity.email.toLowerCase()
      const allowed=new Set((process.env.GOOGLE_ALLOWED_EMAILS??'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean))
      if(!identity.email_verified||!allowed.has(email))throw new Error('identity not allowed')
      const adminEmail=(process.env.ADMIN_EMAIL??'').trim().toLowerCase(),role=email===adminEmail?'admin' as const:'coordinator' as const
      const user=await options.store.findOrCreateGoogleUser(email,identity.name,role,role==='coordinator'?'5to Elemento':null)
      if(!user.active)throw new Error('identity inactive')
      flow.user=user;flow.status='complete';flows.set(flowId,flow)
      return reply.type('text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><title>SPL</title><p>Acceso completado. Ya puedes cerrar esta ventana y volver a SPL.</p>')
    }catch{flow.status='error';flows.set(flowId,flow);return reply.code(400).type('text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><title>SPL</title><p>No se pudo completar el acceso. Regresa a SPL e inténtalo nuevamente.</p>')}
  })
  app.get('/api/auth/google/desktop/status',async(request,reply)=>{
    const {flowId}=statusSchema.parse(request.query),flow=flows.get(flowId)
    if(!flow||flow.expiresAt<=Date.now())return reply.code(404).send({error:'Solicitud no encontrada'})
    if(flow.status==='error')return reply.code(400).send({error:'No se pudo autorizar la cuenta'})
    if(flow.status==='pending')return reply.code(202).send({data:{status:'pending'}})
    flows.delete(flowId)
    return {data:{status:'complete',user:await issueSession(reply,options.store,flow.user!)}}
  })
}
