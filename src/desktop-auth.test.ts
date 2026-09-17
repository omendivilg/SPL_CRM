import {describe,expect,it,vi} from 'vitest'
import {waitForDesktopGoogle} from './desktop-auth'

const user={userId:'u1',email:'omendivilg@gmail.com',displayName:'Oscar',role:'admin' as const,unit:null}

describe('waitForDesktopGoogle',()=>{
  it('waits through pending states and returns the authenticated user',async()=>{
    const status=vi.fn().mockResolvedValueOnce({status:'pending'}).mockResolvedValueOnce({status:'complete',user})
    const pause=vi.fn().mockResolvedValue(undefined)
    await expect(waitForDesktopGoogle('11111111-1111-4111-8111-111111111111',status,pause,3)).resolves.toEqual(user)
    expect(pause).toHaveBeenCalledWith(1000)
  })

  it('rejects malformed flow identifiers before polling',async()=>{
    const status=vi.fn()
    await expect(waitForDesktopGoogle('../../cookie',status,vi.fn(),1)).rejects.toThrow('Flujo inválido')
    expect(status).not.toHaveBeenCalled()
  })

  it('expires a flow that never completes',async()=>{
    await expect(waitForDesktopGoogle('11111111-1111-4111-8111-111111111111',async()=>({status:'pending'}),async()=>{},2)).rejects.toThrow('venció')
  })
})
