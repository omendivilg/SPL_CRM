import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { router } from 'expo-router'
import * as Crypto from 'expo-crypto'
import { addQuickExpense } from '../../api'
import { Card, Field, Screen, ui } from '../../components'
import { colors } from '../../theme'
import { useSession } from '../../session'
import { normalizeMoney } from '../../money'
import { DEFAULT_EXPENSE_CATEGORY, EXPENSE_CATEGORIES } from '../../../../src/expense-categories'

type Unit='SPL'|'5to Elemento'
const today=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
export default function NewExpense(){
  const {businessScope,user}=useSession()
  const [name,setName]=useState(''),[category,setCategory]=useState<string>(DEFAULT_EXPENSE_CATEGORY)
  const [amount,setAmount]=useState(''),[expenseDate,setDate]=useState(today())
  const [unit,setUnit]=useState<Unit>(businessScope==='5to Elemento'?'5to Elemento':'SPL'),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [notes,setNotes]=useState(''),[paymentMethod,setPaymentMethod]=useState<'cash'|'card'>('cash')
  const save=async()=>{
    setBusy(true);setError('')
    try{
      const normalized=normalizeMoney(amount)
      if(!name.trim()||!normalized||normalized==='0.00')throw new Error('Escribe nombre e importe mayor que cero con máximo dos decimales.')
      if(!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate))throw new Error('Usa la fecha AAAA-MM-DD.')
      await addQuickExpense(Crypto.randomUUID(),{name:name.trim(),category,amount:normalized,expenseDate,businessUnit:unit,notes:notes.trim(),paymentMethod})
      router.back()
    }catch(reason){setError(reason instanceof Error?reason.message:'No se pudo guardar.')}finally{setBusy(false)}
  }
  if(user?.role==='coordinator')return <Screen title="Gasto nuevo"><Text style={ui.error}>No tienes acceso a Finanzas.</Text></Screen>
  return <Screen title="Gasto nuevo">
    <Field label="Nombre del gasto" value={name} maxLength={200} onChangeText={setName}/>
    <Text style={ui.label}>Categoría</Text>
    <Card>{EXPENSE_CATEGORIES.map(option=><Pressable key={option} accessibilityRole="radio" accessibilityState={{selected:category===option}} onPress={()=>setCategory(option)}><Text style={[ui.text,category===option&&{color:colors.orange}]}>{category===option?'●':'○'} {option}</Text></Pressable>)}</Card>
    <Field label="Monto MXN" value={amount} keyboardType="decimal-pad" onChangeText={setAmount}/>
    <Field label="Fecha de pago (AAAA-MM-DD)" value={expenseDate} onChangeText={setDate}/>
    <Field label="Notas (opcional)" value={notes} onChangeText={setNotes} multiline maxLength={1000}/>
    <Text style={ui.label}>Forma de pago</Text>
    <View style={ui.row}>{([['cash','Efectivo'],['card','Tarjeta']] as const).map(([value,label])=><Pressable key={value} accessibilityRole="radio" accessibilityState={{selected:paymentMethod===value}} style={[ui.secondaryButton,{flex:1,borderColor:paymentMethod===value?colors.orange:colors.border}]} onPress={()=>setPaymentMethod(value)}><Text style={ui.buttonText}>{label}</Text></Pressable>)}</View>
    <Text style={ui.label}>Asignar a</Text>
    <View style={ui.row}>{(['SPL','5to Elemento'] as const).map(choice=><Pressable key={choice} accessibilityRole="radio" accessibilityState={{selected:unit===choice}} style={[ui.secondaryButton,{flex:1,borderColor:unit===choice?colors.orange:colors.border}]} onPress={()=>setUnit(choice)}><Text style={ui.buttonText}>{choice==='SPL'?'SPL eventos propios':'5to Elemento'}</Text></Pressable>)}</View>
    {error&&<Text style={ui.error}>{error}</Text>}
    <Pressable disabled={busy} style={ui.button} onPress={save}><Text style={ui.buttonText}>{busy?'Guardando...':'Guardar gasto'}</Text></Pressable>
  </Screen>
}
