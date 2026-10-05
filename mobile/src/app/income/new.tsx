import {useState} from 'react'
import {Pressable,Text,View} from 'react-native'
import {router} from 'expo-router'
import * as Crypto from 'expo-crypto'
import {createDirectIncome} from '../../api'
import {Field,Screen,ui} from '../../components'
import {useSession} from '../../session'
import {colors} from '../../theme'
import {normalizeMoney} from '../../money'

type Unit='SPL'|'5to Elemento'
const today=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
const validDate=(value:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(`${value}T12:00:00`);return !Number.isNaN(date.getTime())&&date.getFullYear()===Number(value.slice(0,4))&&date.getMonth()+1===Number(value.slice(5,7))&&date.getDate()===Number(value.slice(8,10))}

export default function NewIncome(){
  const {businessScope,user}=useSession()
  const [name,setName]=useState(''),[amount,setAmount]=useState(''),[date,setDate]=useState(today()),[notes,setNotes]=useState('')
  const [unit,setUnit]=useState<Unit>(businessScope==='5to Elemento'?'5to Elemento':'SPL')
  const [received,setReceived]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const save=async()=>{
    setError('')
    const normalized=normalizeMoney(amount)
    if(!name.trim()||!normalized||normalized==='0.00'){setError('Escribe un nombre y monto mayor que cero con máximo dos decimales.');return}
    if(!validDate(date)){setError('Usa una fecha válida en formato AAAA-MM-DD.');return}
    setBusy(true)
    try{
      await createDirectIncome(Crypto.randomUUID(),{name:name.trim(),amount:normalized,businessUnit:unit,expectedDate:date,receivedDate:received?date:null,notes:notes.trim()||null})
      router.replace('/(tabs)/finance')
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo guardar la utilidad.')}
    finally{setBusy(false)}
  }
  if(user?.role==='coordinator')return <Screen title="Utilidad"><Text style={ui.error}>No tienes acceso a Finanzas.</Text></Screen>
  return <Screen title="Nueva utilidad">
    <Field label="Nombre de la utilidad" value={name} maxLength={200} onChangeText={setName}/>
    <Field label="Monto MXN" value={amount} keyboardType="decimal-pad" onChangeText={setAmount}/>
    <Text style={ui.label}>Compañía</Text>
    <View style={ui.row}>{(['SPL','5to Elemento'] as const).map(choice=><Pressable key={choice} accessibilityRole="radio" accessibilityState={{selected:unit===choice}} style={[ui.secondaryButton,{flex:1,borderColor:unit===choice?colors.orange:colors.border}]} onPress={()=>setUnit(choice)}><Text style={ui.buttonText}>{choice}</Text></Pressable>)}</View>
    <Text style={ui.label}>Estado del cobro</Text>
    <View style={ui.row}>{([['pending','Pendiente'],['received','Pagada']] as const).map(([value,label])=><Pressable key={value} accessibilityRole="radio" accessibilityState={{selected:received===(value==='received')}} style={[ui.secondaryButton,{flex:1,borderColor:received===(value==='received')?colors.orange:colors.border}]} onPress={()=>setReceived(value==='received')}><Text style={ui.buttonText}>{label}</Text></Pressable>)}</View>
    <Field label={received?'Fecha de cobro (AAAA-MM-DD)':'Fecha prevista (AAAA-MM-DD)'} value={date} onChangeText={setDate}/>
    <Field label="Notas (opcional)" value={notes} onChangeText={setNotes} maxLength={2000} multiline textAlignVertical="top" style={{minHeight:104,paddingVertical:12}}/>
    {error&&<Text style={ui.error}>{error}</Text>}
    <Pressable disabled={busy} style={ui.button} onPress={save}><Text style={ui.buttonText}>{busy?'Guardando...':'Guardar utilidad'}</Text></Pressable>
    <Pressable style={ui.secondaryButton} onPress={()=>router.back()}><Text style={ui.buttonText}>Cancelar</Text></Pressable>
  </Screen>
}
