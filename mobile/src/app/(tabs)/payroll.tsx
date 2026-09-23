import {useEffect,useState} from 'react'
import {Pressable,Text} from 'react-native'
import {router} from 'expo-router'
import {Card,Money,Screen,ui} from '../../components'
import {listPayroll,type Payroll} from '../../api'
import {colors} from '../../theme'
export default function Payrolls(){const [items,setItems]=useState<Payroll[]>([]),[loading,setLoading]=useState(true);useEffect(()=>{listPayroll().then(setItems).finally(()=>setLoading(false))},[]);return <Screen title="Nóminas" loading={loading} action={<Pressable style={ui.button} onPress={()=>router.push('/payroll/new')}><Text style={ui.buttonText}>Nueva</Text></Pressable>}>{!items.length?<Text style={ui.empty}>No hay nóminas.</Text>:items.map(item=><Card key={item.id} onPress={()=>router.push({pathname:'/payroll/[id]',params:{id:item.id}})}><Text style={ui.text}>{item.periodStart} al {item.periodEnd}</Text><Text style={[ui.label,{color:item.status==='paid'?colors.green:colors.danger}]}>{item.status==='paid'?'Pagada':'No pagada'} · {item.lines.length} trabajadores</Text><Money value={item.total}/></Card>)}</Screen>}
