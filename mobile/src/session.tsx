import {createContext,useContext,useEffect,useRef,useState,type PropsWithChildren} from 'react'
import * as SecureStore from 'expo-secure-store'
import {currentUser,logout as closeSession,type User} from './api'

export type BusinessScope='SPL'|'5to Elemento'|'Todos'
type Session={user:User|null;loading:boolean;setUser:(user:User|null)=>void;businessScope:BusinessScope;setBusinessScope:(scope:BusinessScope)=>void;logout:()=>Promise<void>}
const Context=createContext<Session|null>(null)
const key='spl.business.scope'
export function SessionProvider({children}:PropsWithChildren){
  const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true)
  const [selection,setSelection]=useState<{userId:string;scope:BusinessScope}|null>(null)
  const writes=useRef(Promise.resolve())
  useEffect(()=>{currentUser().then(setUser).finally(()=>setLoading(false))},[])
  useEffect(()=>{
    let active=true
    if(!user||user.role==='coordinator')return
    void SecureStore.getItemAsync(key).then(raw=>{
      const preferences=raw?JSON.parse(raw) as Record<string,BusinessScope>:{}
      const saved=preferences[user.userId]
      if(active&&['SPL','5to Elemento','Todos'].includes(saved))setSelection(current=>current?.userId===user.userId?current:{userId:user.userId,scope:saved})
    }).catch(()=>{})
    return()=>{active=false}
  },[user])
  const setBusinessScope=(scope:BusinessScope)=>{
    if(!user||user.role==='coordinator')return
    setSelection({userId:user.userId,scope})
    writes.current=writes.current.then(async()=>{
      const raw=await SecureStore.getItemAsync(key)
      const preferences=raw?JSON.parse(raw) as Record<string,BusinessScope>:{}
      preferences[user.userId]=scope
      await SecureStore.setItemAsync(key,JSON.stringify(preferences))
    }).catch(()=>{})
  }
  const businessScope=user?.role==='coordinator'?'5to Elemento':selection&&selection.userId===user?.userId?selection.scope:'Todos'
  return <Context.Provider value={{user,loading,setUser,businessScope,setBusinessScope,logout:async()=>{await closeSession();setUser(null)}}}>{children}</Context.Provider>
}
export function useSession(){const value=useContext(Context);if(!value)throw new Error('SessionProvider missing');return value}
