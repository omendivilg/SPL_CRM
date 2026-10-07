import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { z } from 'zod'
import { registerDesktopGoogleRoutes } from './desktop-google.js'

export function centralOrigin(value:string){
  const url=new URL(value)
  if(url.origin!=='https://spl-crm.fly.dev'||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw new Error('Invalid central API URL')
  return url.origin
}

const sessionSchema=z.object({data:z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/),expiresAt:z.iso.datetime(),user:z.object({userId:z.string(),email:z.email(),displayName:z.string(),role:z.enum(['admin','owner','coordinator']),unit:z.enum(['SPL','5to Elemento']).nullable()})})})

export async function buildRemoteDesktop(options:{apiUrl:string;redirectBase:string;clientId?:string;clientSecret?:string;fetcher?:typeof fetch}){
  const origin=centralOrigin(options.apiUrl),local=new URL(options.redirectBase),fetcher=options.fetcher??fetch
  const app=Fastify({bodyLimit:32*1024,logger:false})
  await app.register(cookie)
  await app.register(rateLimit,{global:false})
  app.addHook('onSend',async(request,reply,payload)=>{if(request.url.startsWith('/api/'))reply.header('cache-control','no-store');return payload})
  app.addHook('onRequest',async(request,reply)=>{
    if(request.headers.host!==local.host)return reply.code(403).send({error:'Origen inválido'})
    const callback=request.url.startsWith('/api/auth/google/desktop/callback?')
    if(!callback&&(request.headers.origin&&request.headers.origin!==local.origin||request.headers['sec-fetch-site']==='cross-site'))return reply.code(403).send({error:'Origen inválido'})
  })
  const remoteFetch=(path:string,init:RequestInit={})=>fetcher(`${origin}${path}`,{...init,redirect:'error',signal:AbortSignal.timeout(15_000)})
  registerDesktopGoogleRoutes(app,{
    clientId:options.clientId,clientSecret:options.clientSecret,redirectBase:options.redirectBase,fetcher,
    exchangeIdentity:async credential=>{
      const response=await remoteFetch('/api/auth/google/native',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential})})
      if(!response.ok)throw new Error('Central authentication rejected')
      return sessionSchema.parse(await response.json()).data
    },
  })
  app.get('/health',async(_request,reply)=>{
    reply.header('cache-control','no-store')
    try{
      const response=await remoteFetch('/health')
      const body=await response.json() as {status?:unknown}
      if(response.ok&&body.status==='ok')return {status:'ok'}
    }catch{ /* The loopback UI remains available while the central server is offline. */ }
    return reply.code(503).send({status:'unavailable'})
  })
  app.get('/api/auth/test-login/config',async()=>({data:{enabled:false}}))
  app.all('/api/*',async(request,reply)=>{
    // Decode before validation so encoded traversal cannot escape the API prefix.
    let pathname:string
    try{pathname=decodeURIComponent(request.url.split('?')[0])}catch{return reply.code(400).send({error:'Ruta inválida'})}
    if(!pathname.startsWith('/api/')||pathname.includes('\\')||pathname.split('/').some(part=>part==='..'||part==='.')||pathname.includes('//'))return reply.code(400).send({error:'Ruta inválida'})
    if(pathname.startsWith('/api/auth/test-login')||pathname.startsWith('/api/auth/google/desktop/')||pathname==='/api/auth/google/native')return reply.code(404).send({error:'Ruta no encontrada'})
    const headers:Record<string,string>={}
    if(request.headers['content-type'])headers['content-type']=request.headers['content-type']
    const token=request.cookies.spl_session
    if(token&&/^[A-Za-z0-9_-]{43}$/.test(token))headers.authorization=`Bearer ${token}`
    try{
      const response=await remoteFetch(request.url,{method:request.method,headers,body:request.body===undefined?undefined:JSON.stringify(request.body)})
      const setCookie=response.headers.get('set-cookie')
      const remoteToken=setCookie?.match(/(?:^|,\s*)spl_session=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1]
      if(remoteToken)reply.setCookie('spl_session',remoteToken,{httpOnly:true,sameSite:'strict',secure:false,path:'/',maxAge:180*24*60*60})
      if(pathname==='/api/auth/logout'&&response.ok)reply.clearCookie('spl_session',{path:'/'})
      for(const name of ['content-type','content-disposition','cache-control']){const value=response.headers.get(name);if(value)reply.header(name,value)}
      reply.header('cache-control','no-store')
      return reply.code(response.status).send(Buffer.from(await response.arrayBuffer()))
    }catch{return reply.code(503).send({error:'No se pudo conectar al servidor. Revisa tu conexión a internet e inténtalo nuevamente.'})}
  })
  return app
}
