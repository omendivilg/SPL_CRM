import {useCallback,useRef,useState} from 'react'
import {useFocusEffect} from 'expo-router'
import {listDirectIncome,listEvents,listExpenses,listPayments,listPayroll,listQuickExpenses,listExpenseSettlements,listLegacyPayroll} from './api'
import {emptyFinancialData,type FinancialData} from './finance-model'
import {useSession} from './session'

export function useFinancialData(){
  const {user}=useSession()
  const [data,setData]=useState<FinancialData>(emptyFinancialData),[loading,setLoading]=useState(true),[error,setError]=useState('')
  const version=useRef(0)
  const load=useCallback(async()=>{
    if(!user||user.role==='coordinator')return
    const current=++version.current
    setLoading(true);setError('')
    try{
      const [events,income,payroll,quick,settlements,legacy]=await Promise.all([listEvents(),listDirectIncome(),listPayroll(),listQuickExpenses(),listExpenseSettlements(),listLegacyPayroll()])
      const [payments,expenses]=await Promise.all([Promise.all(events.map(event=>listPayments(event.id))),Promise.all(events.map(event=>listExpenses(event.id)))])
      if(current===version.current)setData({events,income,payroll,quick,settlements,legacy,payments:payments.flatMap((rows,index)=>rows.map(payment=>({event:events[index],payment}))),expenses:expenses.flatMap((rows,index)=>rows.map(expense=>({event:events[index],expense})))})
    }catch(cause){if(current===version.current){setData(emptyFinancialData());setError(cause instanceof Error?cause.message:'No se pudieron cargar los datos financieros.')}}
    finally{if(current===version.current)setLoading(false)}
  },[user])
  useFocusEffect(useCallback(()=>{void load();return()=>{version.current++}},[load]))
  return {data,loading,error,reload:load}
}
