import type { DesktopGoogleStatus, SessionUser } from './api'

export async function waitForDesktopGoogle(
  flowId:string,
  status:(flowId:string)=>Promise<DesktopGoogleStatus>,
  pause:(milliseconds:number)=>Promise<void>=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds)),
  attempts=300,
):Promise<SessionUser>{
  if(!/^[0-9a-f-]{36}$/i.test(flowId))throw new Error('Flujo inválido')
  for(let attempt=0;attempt<attempts;attempt++){
    const result=await status(flowId)
    if(result.status==='complete')return result.user
    await pause(1000)
  }
  throw new Error('El acceso con Google venció')
}
