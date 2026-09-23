import {createContext,useContext,useEffect,useState,type PropsWithChildren} from 'react'
import {currentUser,logout as closeSession,type User} from './api'

type Session={user:User|null;loading:boolean;setUser:(user:User|null)=>void;logout:()=>Promise<void>}
const Context=createContext<Session|null>(null)
export function SessionProvider({children}:PropsWithChildren){const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true);useEffect(()=>{currentUser().then(setUser).finally(()=>setLoading(false))},[]);return <Context.Provider value={{user,loading,setUser,logout:async()=>{await closeSession();setUser(null)}}}>{children}</Context.Provider>}
export function useSession(){const value=useContext(Context);if(!value)throw new Error('SessionProvider missing');return value}
