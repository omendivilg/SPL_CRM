import {createContext,useCallback,useContext,useEffect,useRef,useState,type PropsWithChildren} from 'react'
import * as SecureStore from 'expo-secure-store'
import {dashboardPeriod,shiftFinancialPeriod,type SavedPeriod} from '../../src/dashboard/period'
import {useSession} from './session'

export const todayLocal=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
export const validDate=(value:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(`${value}T12:00:00Z`);return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value}
const key='spl.financial.period'
type Value={selectedPeriod:SavedPeriod;period:ReturnType<typeof dashboardPeriod>;ready:boolean;error:string;setSelectedPeriod:(period:SavedPeriod)=>void;shift:(amount:number)=>void}
const Context=createContext<Value|null>(null)
const freshPeriod=():SavedPeriod=>({mode:'week',anchor:todayLocal()})
const validPeriod=(raw:unknown):raw is SavedPeriod=>typeof raw==='object'&&raw!==null&&'mode' in raw&&(raw.mode==='week'||raw.mode==='month')&&'anchor' in raw&&typeof raw.anchor==='string'&&validDate(raw.anchor)

export function FinancialPeriodProvider({children}:PropsWithChildren){
  const {user}=useSession()
  const [selection,setSelection]=useState<{userId:string;period:SavedPeriod}|null>(null)
  const [loadedUser,setLoadedUser]=useState<string|null>(null),[error,setError]=useState('')
  const writes=useRef(Promise.resolve())
  const revision=useRef(0)
  useEffect(()=>{
    let active=true
    const currentRevision=revision.current
    if(!user)return
    void SecureStore.getItemAsync(key).then(raw=>{
      const preferences=raw?JSON.parse(raw) as Record<string,unknown>:{}
      const saved=preferences[user.userId]
      if(active&&revision.current===currentRevision)setSelection({userId:user.userId,period:validPeriod(saved)?saved:freshPeriod()})
    }).catch(()=>{if(active){setSelection({userId:user.userId,period:freshPeriod()});setError('No pudimos recuperar el periodo guardado.')}}).finally(()=>{if(active)setLoadedUser(user.userId)})
    return()=>{active=false}
  },[user])
  const selectedPeriod=selection&&selection.userId===user?.userId?selection.period:freshPeriod()
  const setSelectedPeriod=useCallback((period:SavedPeriod)=>{
    if(!user||!validPeriod(period))return
    revision.current++
    setSelection({userId:user.userId,period});setError('')
    writes.current=writes.current.then(async()=>{
      let preferences:Record<string,SavedPeriod>={}
      const raw=await SecureStore.getItemAsync(key)
      if(raw){try{const value=JSON.parse(raw);if(value&&typeof value==='object'&&!Array.isArray(value))preferences=value}catch{/* Replace an invalid preference document. */}}
      preferences[user.userId]=period
      await SecureStore.setItemAsync(key,JSON.stringify(preferences))
    }).catch(()=>setError('El periodo se mantiene en esta sesión, pero no pudimos guardarlo en el dispositivo.'))
  },[user])
  return <Context.Provider value={{selectedPeriod,period:dashboardPeriod(selectedPeriod.anchor,selectedPeriod.mode),ready:!user||loadedUser===user.userId,error,setSelectedPeriod,shift:amount=>setSelectedPeriod(shiftFinancialPeriod(selectedPeriod,amount))}}>{children}</Context.Provider>
}
export function useFinancialPeriod(){const value=useContext(Context);if(!value)throw new Error('FinancialPeriodProvider missing');return value}
