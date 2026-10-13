import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { Card, Money, Screen, ui } from '../../components'
import { listEvents, listPayments, type EventRecord } from '../../api'
import { colors } from '../../theme'
import { useSession } from '../../session'

export default function Events() {
  const {user,businessScope}=useSession()
  return <EventList key={`${user?.userId}:${user?.role}:${businessScope}`}/>
}

function EventList() {
  const [items, setItems] = useState<EventRecord[]>([])
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestVersion=useRef(0)
  const scroll=useRef<ScrollView>(null),offset=useRef(0),viewport=useRef(0),contentHeight=useRef(0)
  const restoreOffset=useRef<number|null>(null)
  const {user,businessScope}=useSession()
  const role=user?.role
  const restore=useCallback(()=>{
    if(restoreOffset.current!==null&&viewport.current>0&&scroll.current){
      const y=Math.min(restoreOffset.current,Math.max(0,contentHeight.current-viewport.current))
      scroll.current.scrollTo({y,animated:false})
      offset.current=y
      restoreOffset.current=null
    }
  },[])
  useEffect(()=>{
    const frame=requestAnimationFrame(restore)
    return()=>cancelAnimationFrame(frame)
  },[items,error,loading,restore])

  const load=useCallback(async()=>{
    const version=++requestVersion.current
    try {
      const events=(await listEvents()).filter(event=>businessScope==='Todos'||event.businessUnit===businessScope)
      const paid=new Set<string>()
      if(role!=='coordinator'){
        const movements=await Promise.all(events.map(event=>listPayments(event.id)))
        events.forEach((event,index)=>{
          const price=Number(event.agreedPrice??0),received=movements[index].reduce((sum,payment)=>sum+(payment.kind==='refund'?-Number(payment.amount):Number(payment.amount)),0)
          if(price>0&&Math.round(received*100)>=Math.round(price*100))paid.add(event.id)
        })
      }
      if(version===requestVersion.current){restoreOffset.current=offset.current;setItems(events);setPaidIds(paid);setError('');setLoading(false)}
    } catch(reason){if(version===requestVersion.current){restoreOffset.current=offset.current;setError(reason instanceof Error?reason.message:'No se pudieron cargar los eventos.');setLoading(false)}}
  },[role,businessScope])
  useFocusEffect(useCallback(()=>{
    void load()
    return()=>{requestVersion.current++}
  },[load]))

  return <Screen title="Eventos" loading={loading} scrollRef={scroll} scrollProps={{scrollEventThrottle:16,onScroll:event=>{offset.current=event.nativeEvent.contentOffset.y},onLayout:event=>{viewport.current=event.nativeEvent.layout.height;restore()},onContentSizeChange:(_width,height)=>{contentHeight.current=height;restore()}}} action={<View style={{flexDirection:'row',gap:6}}>{role!=='coordinator'&&<Pressable style={ui.secondaryButton} onPress={() => router.push('/income/new')}><Text style={ui.buttonText}>Utilidad</Text></Pressable>}<Pressable style={ui.button} onPress={() => router.push('/event/new')}><Text style={ui.buttonText}>Evento</Text></Pressable></View>}>
    {role!=='coordinator'&&<Pressable style={ui.secondaryButton} onPress={() => router.push('/expense/new')}><Text style={ui.buttonText}>+ Gasto nuevo</Text></Pressable>}
    {error && <View style={{gap:8}}><Text style={styles.error}>{error}{items.length?' Se muestran los últimos eventos cargados.':''}</Text><Pressable style={ui.secondaryButton} onPress={()=>void load()}><Text style={ui.buttonText}>Reintentar</Text></Pressable></View>}
    {!items.length && !error ? <Text style={ui.empty}>No hay eventos.</Text> : items.map(event => <Card key={event.id} onPress={() => router.push({ pathname: '/event/[id]', params: { id: event.id } })}>
      <Text style={ui.text}>{event.clientName}</Text>
      <Text style={ui.label}>{event.venue} · {event.eventDate}</Text>
      <Text style={[styles.status,paidIds.has(event.id)&&styles.paid]}>{paidIds.has(event.id)?'Pagado':event.operationalStatus}</Text>
      {event.agreedPrice && <Money value={event.agreedPrice} />}
    </Card>)}
  </Screen>
}

const styles = StyleSheet.create({ error: { color: '#fecaca', padding: 14, backgroundColor: '#3b1717', borderRadius: 10 }, status: { color: colors.orange, fontSize: 13, fontWeight: '700' }, paid:{color:colors.green} })
