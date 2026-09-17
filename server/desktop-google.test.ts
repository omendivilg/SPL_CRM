import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {registerDesktopGoogleRoutes} from './desktop-google.js'
import type {LoginUser,SessionStore} from './sessions.js'

const originalAllowed=process.env.GOOGLE_ALLOWED_EMAILS
const originalAdmin=process.env.ADMIN_EMAIL
afterEach(()=>{process.env.GOOGLE_ALLOWED_EMAILS=originalAllowed;process.env.ADMIN_EMAIL=originalAdmin})

function store(active=true){
  const user:LoginUser={id:'u1',email:'omendivilg@gmail.com',displayName:'Oscar',role:'admin',businessUnit:null,passwordHash:null,active}
  return {findUserByEmail:vi.fn(),createSession:vi.fn(),findPrincipal:vi.fn(),revokeSession:vi.fn(),findOrCreateGoogleUser:vi.fn().mockResolvedValue(user)} satisfies SessionStore
}

async function appFor(options:{clientId?:string;active?:boolean;identityEmail?:string}={}){
  const app=Fastify();await app.register(cookie)
  const sessionStore=store(options.active)
  const openExternal=vi.fn()
  const fetcher=vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({access_token:'a'.repeat(32)}),{status:200,headers:{'content-type':'application/json'}}))
    .mockResolvedValueOnce(new Response(JSON.stringify({email:options.identityEmail??'omendivilg@gmail.com',name:'Oscar',email_verified:true}),{status:200,headers:{'content-type':'application/json'}}))
  registerDesktopGoogleRoutes(app,{store:sessionStore,clientId:options.clientId,redirectBase:'http://127.0.0.1:43123',openExternal,fetcher})
  await app.ready();return {app,sessionStore,openExternal,fetcher}
}

describe('desktop Google OAuth',()=>{
  it('uses the system authorization flow with state and PKCE, then creates a session',async()=>{
    process.env.GOOGLE_ALLOWED_EMAILS='omendivilg@gmail.com';process.env.ADMIN_EMAIL='omendivilg@gmail.com'
    const {app,sessionStore,openExternal,fetcher}=await appFor({clientId:'desktop.apps.googleusercontent.com'})
    const started=await app.inject({method:'POST',url:'/api/auth/google/desktop/start'})
    expect(started.statusCode).toBe(200)
    const flowId=started.json().data.flowId as string
    const authorization=new URL(openExternal.mock.calls[0][0])
    expect(authorization.hostname).toBe('accounts.google.com')
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const callback=await app.inject({url:`/api/auth/google/desktop/callback?code=${'c'.repeat(20)}&state=${authorization.searchParams.get('state')}`})
    expect(callback.statusCode).toBe(200)
    const tokenBody=fetcher.mock.calls[0][1].body as URLSearchParams
    expect(tokenBody.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{64}$/)
    expect(tokenBody.get('client_secret')).toBeNull()
    const status=await app.inject({url:`/api/auth/google/desktop/status?flowId=${flowId}`})
    expect(status.statusCode).toBe(200)
    expect(status.cookies.some(value=>value.name==='spl_session')).toBe(true)
    expect(sessionStore.createSession).toHaveBeenCalledOnce()
    await app.close()
  })

  it('reports disabled configuration without opening a browser',async()=>{
    const {app,openExternal}=await appFor()
    expect((await app.inject('/api/auth/google/desktop/config')).json()).toEqual({data:{enabled:false}})
    expect((await app.inject({method:'POST',url:'/api/auth/google/desktop/start'})).statusCode).toBe(503)
    expect(openExternal).not.toHaveBeenCalled()
    await app.close()
  })

  it('rejects forged state and unauthorized identities without a session',async()=>{
    process.env.GOOGLE_ALLOWED_EMAILS='omendivilg@gmail.com';process.env.ADMIN_EMAIL='omendivilg@gmail.com'
    const {app,sessionStore,openExternal}=await appFor({clientId:'desktop.apps.googleusercontent.com',identityEmail:'attacker@example.com'})
    const started=await app.inject({method:'POST',url:'/api/auth/google/desktop/start'}),flowId=started.json().data.flowId
    expect((await app.inject({url:`/api/auth/google/desktop/callback?code=${'c'.repeat(20)}&state=${'x'.repeat(43)}`})).statusCode).toBe(400)
    const authorization=new URL(openExternal.mock.calls[0][0])
    expect((await app.inject({url:`/api/auth/google/desktop/callback?code=${'c'.repeat(20)}&state=${authorization.searchParams.get('state')}`})).statusCode).toBe(400)
    expect((await app.inject({url:`/api/auth/google/desktop/status?flowId=${flowId}`})).statusCode).toBe(400)
    expect(sessionStore.createSession).not.toHaveBeenCalled()
    await app.close()
  })
})
