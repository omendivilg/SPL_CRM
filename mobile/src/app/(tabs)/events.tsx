import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { Card, Money, Screen, ui } from '../../components'
import { listEvents, listPayments, type EventRecord } from '../../api'
import { colors } from '../../theme'
import { useSession } from '../../session'

export default function Events() {
  const [items, setItems] = useState<EventRecord[]>([])
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const {user}=useSession()
  const role=user?.role

  useFocusEffect(useCallback(() => {
    let active = true
    void (async()=>{
      try {
        const events=await listEvents()
        const paid=new Set<string>()
        if(role!=='coordinator'){
          const movements=await Promise.all(events.map(event=>listPayments(event.id)))
          events.forEach((event,index)=>{
            const price=Number(event.agreedPrice??0),received=movements[index].reduce((sum,payment)=>sum+(payment.kind==='refund'?-Number(payment.amount):Number(payment.amount)),0)
            if(price>0&&Math.round(received*100)>=Math.round(price*100))paid.add(event.id)
          })
        }
        if(active){setItems(events);setPaidIds(paid);setError('');setLoading(false)}
      } catch(reason){if(active){setError(reason instanceof Error?reason.message:'No se pudieron cargar los eventos.');setLoading(false)}}
    })()
    return () => { active = false }
  }, [role]))

  return <Screen title="Eventos" loading={loading} action={<Pressable style={ui.button} onPress={() => router.push('/event/new')}><Text style={ui.buttonText}>Nuevo</Text></Pressable>}>
    {error && <Text style={styles.error}>{error}</Text>}
    {!items.length && !error ? <Text style={ui.empty}>No hay eventos.</Text> : items.map(event => <Card key={event.id} onPress={() => router.push({ pathname: '/event/[id]', params: { id: event.id } })}>
      <Text style={ui.text}>{event.clientName}</Text>
      <Text style={ui.label}>{event.venue} · {event.eventDate}</Text>
      <Text style={[styles.status,paidIds.has(event.id)&&styles.paid]}>{paidIds.has(event.id)?'Pagado':event.operationalStatus}</Text>
      {event.agreedPrice && <Money value={event.agreedPrice} />}
    </Card>)}
  </Screen>
}

const styles = StyleSheet.create({ error: { color: '#fecaca', padding: 14, backgroundColor: '#3b1717', borderRadius: 10 }, status: { color: colors.orange, fontSize: 13, fontWeight: '700' }, paid:{color:colors.green} })
