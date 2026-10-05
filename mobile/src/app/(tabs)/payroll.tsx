import {useCallback,useState} from 'react'
import {Pressable,Text} from 'react-native'
import {router,useFocusEffect} from 'expo-router'
import {Card,Money,Screen,ui} from '../../components'
import {listPayroll,type Payroll} from '../../api'
import {colors} from '../../theme'
import {useSession} from '../../session'
export default function Payrolls(){
  const {businessScope}=useSession()
  const [items,setItems]=useState<Payroll[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('')
  useFocusEffect(useCallback(()=>{
    let active=true
    setLoading(true)
    listPayroll().then(records=>{if(active){setItems(records.filter(item=>businessScope==='Todos'||item.businessUnit===businessScope));setError('')}}).catch(reason=>{if(active){setItems([]);setError(reason instanceof Error?reason.message:'No se pudieron cargar las nóminas.')}}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[businessScope]))
  return <Screen title="Nóminas" loading={loading} action={<Pressable style={ui.button} onPress={()=>router.push('/payroll/new')}><Text style={ui.buttonText}>Nueva</Text></Pressable>}>
    {error&&<Text style={ui.error}>{error}</Text>}
    {!items.length&&!error?<Text style={ui.empty}>No hay nóminas.</Text>:items.map(item=><Card key={item.id} onPress={()=>router.push({pathname:'/payroll/[id]',params:{id:item.id}})}><Text style={ui.text}>{item.name||`${item.periodStart} al ${item.periodEnd}`}</Text>{item.name&&<Text style={ui.label}>{item.periodStart} al {item.periodEnd}</Text>}<Text style={[ui.label,{color:item.status==='paid'?colors.green:colors.danger}]}>{item.status==='paid'?'Pagada':'No pagada'} · {item.lines.length} trabajadores</Text><Money value={item.total}/></Card>)}
  </Screen>
}
