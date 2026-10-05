import {useState} from 'react'
import {Pressable,Text,View} from 'react-native'
import {router} from 'expo-router'
import {createEvent} from '../../api'
import {Field,Screen,ui} from '../../components'
import {useSession} from '../../session'
import {colors} from '../../theme'

type Unit='SPL'|'5to Elemento'
const today=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
export default function NewEvent(){
  const {businessScope,user}=useSession()
  const [clientName,setClient]=useState(''),[venue,setVenue]=useState(''),[eventDate,setDate]=useState(today()),[agreedPrice,setPrice]=useState('')
  const [unit,setUnit]=useState<Unit>(businessScope==='5to Elemento'?'5to Elemento':'SPL')
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const save=async()=>{
    setBusy(true);setError('')
    try{
      const operational={businessUnit:unit,clientName:clientName.trim(),clientPhone:null,venue:venue.trim(),eventDate,operationalStatus:'Pendiente',operationalNotes:null}
      await createEvent(user?.role==='coordinator'?operational:{...operational,financialNotes:null,agreedPrice:agreedPrice||null})
      router.replace('/(tabs)/events')
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo guardar.')}
    finally{setBusy(false)}
  }
  return <Screen title="Nuevo evento">
    <Field label="Cliente" value={clientName} onChangeText={setClient}/>
    <Field label="Lugar" value={venue} onChangeText={setVenue}/>
    <Field label="Fecha (AAAA-MM-DD)" value={eventDate} onChangeText={setDate}/>
    {user?.role!=='coordinator'&&<Field label="Precio acordado" value={agreedPrice} onChangeText={setPrice} keyboardType="decimal-pad"/>}
    <Text style={ui.label}>Compañía</Text>
    {user?.role==='coordinator'?<Text style={ui.text}>5to Elemento</Text>:<View style={ui.row}>{(['SPL','5to Elemento'] as const).map(choice=><Pressable key={choice} accessibilityRole="radio" accessibilityState={{selected:unit===choice}} style={[ui.secondaryButton,{flex:1,borderColor:unit===choice?colors.orange:colors.border}]} onPress={()=>setUnit(choice)}><Text style={ui.buttonText}>{choice}</Text></Pressable>)}</View>}
    {error&&<Text style={ui.error}>{error}</Text>}
    <Pressable disabled={busy||!clientName.trim()||!venue.trim()} style={ui.button} onPress={save}><Text style={ui.buttonText}>{busy?'Guardando...':'Guardar evento'}</Text></Pressable>
    <Pressable style={ui.secondaryButton} onPress={()=>router.back()}><Text style={ui.buttonText}>Cancelar</Text></Pressable>
  </Screen>
}
