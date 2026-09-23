import type { DesktopGoogleStatus, SessionUser } from './api'

export async function waitForDesktopGoogle(
  flowId:string,
  status:(flowId:string)=>Promise<DesktopGoogleStatus>,
  pause:(milliseconds:number)=>Promise<void>=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds)),
  attempts=300,
):Promise<SessionUser>{
  if(!/^[0-9a-f-]{36}$/i.test(flowId))throw new Error('Flujo inválido')
  for(let attempt=0;attempt<attempts;attempt++){
    try{
      const result=await status(flowId)
      if(result.status==='complete')return result.user
    }catch(error){
      if(!(error instanceof Error)||!('kind' in error)||!['network','timeout','server'].includes(String((error as {kind?:unknown}).kind)))throw error
    }
    await pause(1000)
  }
  throw new Error('El acceso con Google venció')
}

export async function openDesktopAuthorization(url:string){
  const parsed=new URL(url)
  if(parsed.protocol!=='https:'||parsed.hostname!=='accounts.google.com')throw new Error('Dirección de autorización inválida')
  const internals=(window as Window&{__TAURI_INTERNALS__?:unknown}).__TAURI_INTERNALS__
  if(internals){const {openUrl}=await import('@tauri-apps/plugin-opener');await openUrl(url);return}
  const opened=window.open(url,'_blank','noopener,noreferrer')
  if(!opened)throw new Error('El navegador bloqueó la ventana de autorización')
}
