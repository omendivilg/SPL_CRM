import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { deletePayroll, listPayroll, payPayroll, reversePayroll, type Payroll } from '../../api'
import { Card, Field, Money, Screen, ui } from '../../components'
import { colors } from '../../theme'
import { useSession } from '../../session'

export default function PayrollDetail(){
  const {businessScope}=useSession()
  const {id}=useLocalSearchParams<{id:string}>()
  const [item,setItem]=useState<Payroll>(),[reason,setReason]=useState(''),[confirmDelete,setConfirmDelete]=useState(false),[error,setError]=useState('')
  useEffect(()=>{listPayroll().then(items=>setItem(items.find(payroll=>payroll.id===id))).catch(cause=>setError(cause instanceof Error?cause.message:'No se pudo cargar.'))},[id])
  if(!item)return <Screen title="Nómina" loading={!error}>{error&&<Text style={ui.error}>{error}</Text>}</Screen>
  if(businessScope!=='Todos'&&item.businessUnit!==businessScope)return <Screen title="Nómina"><Text style={ui.empty}>Esta nómina está fuera de la vista de negocio seleccionada.</Text><Pressable style={ui.secondaryButton} onPress={()=>router.replace('/(tabs)/payroll')}><Text style={ui.buttonText}>Volver a nóminas</Text></Pressable></Screen>
  return <Screen title="Detalle de nómina" action={<Pressable onPress={()=>router.back()}><Text style={ui.label}>Volver</Text></Pressable>}>
    <Card><Text style={ui.text}>{item.name||`${item.periodStart} al ${item.periodEnd}`}</Text>{item.name&&<Text style={ui.label}>{item.periodStart} al {item.periodEnd}</Text>}<Text style={ui.label}>{item.businessUnit==='SPL'?'SPL eventos propios':'5to Elemento'}</Text><Text style={[ui.label,{color:item.status==='paid'?colors.green:colors.danger}]}>{item.status==='paid'?'Pagada':'No pagada'}</Text><Money value={item.total}/></Card>
    <Text style={ui.section}>Trabajadores</Text>
    {item.lines.map(line=><Card key={line.id}><View style={ui.row}><Text style={ui.text}>{line.employeeName}</Text><Money value={line.netPay}/></View></Card>)}
    {item.expenses.length>0&&<><Text style={ui.section}>Otros gastos</Text>{item.expenses.map(expense=><Card key={expense.id}><View style={ui.row}><Text style={ui.text}>{expense.concept}</Text><Money value={expense.amount}/></View><Text style={ui.label}>{expense.category}</Text></Card>)}</>}
    {item.status==='unpaid'?<Pressable style={ui.button} onPress={async()=>{try{setItem(await payPayroll(item,new Date().toISOString().slice(0,10)))}catch(cause){setError(cause instanceof Error?cause.message:'No se pudo registrar el pago.')}}}><Text style={ui.buttonText}>Registrar pago completo</Text></Pressable>:<><Field label="Motivo obligatorio para revertir" value={reason} onChangeText={setReason}/><Pressable disabled={!reason.trim()} style={ui.secondaryButton} onPress={async()=>{try{setItem(await reversePayroll(item,reason));setReason('')}catch(cause){setError(cause instanceof Error?cause.message:'No se pudo revertir.')}}}><Text style={ui.buttonText}>Revertir registro de pago</Text></Pressable></>}
    {confirmDelete?<Card><Text style={ui.text}>¿Eliminar esta nómina y quitar sus costos de los reportes?</Text><View style={ui.row}><Pressable onPress={()=>setConfirmDelete(false)}><Text style={ui.label}>Cancelar</Text></Pressable><Pressable onPress={async()=>{try{await deletePayroll(item);router.replace('/(tabs)/payroll')}catch(cause){setError(cause instanceof Error?cause.message:'No se pudo eliminar.')}}}><Text style={ui.error}>Sí, eliminar</Text></Pressable></View></Card>:<Pressable style={ui.secondaryButton} onPress={()=>setConfirmDelete(true)}><Text style={ui.buttonText}>Eliminar nómina</Text></Pressable>}
    {error&&<Text style={ui.error}>{error}</Text>}
  </Screen>
}
