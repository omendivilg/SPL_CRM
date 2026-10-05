import { useCallback, useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { addExpense, addPayment, deleteEvent, deletePayment, listEvents, listExpenses, listPayments, payRemaining, updatePrice, type EventRecord, type Expense, type Payment } from '../../api'
import { Card, Field, Money, Screen, ui } from '../../components'
import { colors } from '../../theme'
import { useSession } from '../../session'
import { DEFAULT_EXPENSE_CATEGORY, EXPENSE_CATEGORIES } from '../../../../src/expense-categories'

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user, businessScope } = useSession()
  const [event, setEvent] = useState<EventRecord>()
  const [payments, setPayments] = useState<Payment[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [amount, setAmount] = useState('')
  const [concept, setConcept] = useState('')
  const [expenseCategory, setExpenseCategory] = useState<string>(DEFAULT_EXPENSE_CATEGORY)
  const [price, setPrice] = useState('')
  const [error, setError] = useState('')
  const [confirmEvent, setConfirmEvent] = useState(false)
  const [confirmPayment, setConfirmPayment] = useState<string | null>(null)
  const [confirmPay, setConfirmPay] = useState(false)

  const load = useCallback(async () => {
    try {
      const found = (await listEvents()).find(item => item.id === id)
      setEvent(found)
      if (found && user?.role !== 'coordinator') {
        const [nextPayments, nextExpenses] = await Promise.all([listPayments(found.id), listExpenses(found.id)])
        setPayments(nextPayments)
        setExpenses(nextExpenses)
        setPrice(found.agreedPrice ?? '')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo cargar.')
    }
  }, [id, user])

  useEffect(() => {
    const timer = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(timer)
  }, [load])

  if (!event) return <Screen title="Evento" loading={!error}>{error && <Text style={ui.error}>{error}</Text>}</Screen>
  if (businessScope!=='Todos'&&event.businessUnit!==businessScope)return <Screen title="Evento"><Text style={ui.empty}>Este evento está fuera de la vista de negocio seleccionada.</Text><Pressable style={ui.secondaryButton} onPress={()=>router.replace('/(tabs)/events')}><Text style={ui.buttonText}>Volver a eventos</Text></Pressable></Screen>

  const movement = async (kind: 'payment' | 'refund') => {
    try {
      await addPayment(event.id, kind, Number(amount).toFixed(2), new Date().toISOString().slice(0, 10))
      setAmount('')
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.') }
  }
  const received=payments.reduce((sum,payment)=>sum+(payment.kind==='refund'?-Number(payment.amount):Number(payment.amount)),0)
  const balance=event.agreedPrice===null||event.agreedPrice===undefined?null:Math.max(Number(event.agreedPrice)-received,0)
  const isPaid=event.agreedPrice!=null&&Number(event.agreedPrice)>0&&Math.round(received*100)>=Math.round(Number(event.agreedPrice)*100)

  return <Screen title={event.clientName} action={<Pressable onPress={() => router.back()}><Text style={ui.label}>Volver</Text></Pressable>}>
    <Card><Text style={ui.text}>{event.venue}</Text><Text style={[ui.label,isPaid&&{color:colors.green}]}>{event.eventDate} · {isPaid?'Pagado':event.operationalStatus}</Text>{event.agreedPrice && <Money value={event.agreedPrice} />}</Card>
    {user?.role !== 'coordinator' && <>
      <Text style={ui.section}>Precio</Text>
      <Field label="Precio acordado" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
      <Pressable style={ui.button} onPress={async () => { try { setEvent(await updatePrice(event, price || null)) } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo actualizar.') } }}><Text style={ui.buttonText}>Guardar precio</Text></Pressable>
      {event.agreedPrice!==null&&<Pressable style={ui.secondaryButton} onPress={async()=>{try{setEvent(await updatePrice(event,null));setPrice('')}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo quitar el precio.')}}}><Text style={ui.buttonText}>Quitar precio acordado</Text></Pressable>}
      <Text style={ui.section}>Cobros y reembolsos</Text>
      <Card><Text style={ui.label}>Cobrado neto</Text><Money value={received} /><Text style={ui.label}>Saldo por cobrar</Text><Money value={balance??0} /></Card>
      {balance!==null&&balance>0&&(confirmPay?<Card><Text style={ui.text}>Registrarás el saldo completo de {new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(balance)}.</Text><View style={ui.row}><Pressable onPress={()=>setConfirmPay(false)}><Text style={ui.label}>Cancelar</Text></Pressable><Pressable onPress={async()=>{try{await payRemaining(event.id,new Date().toISOString().slice(0,10));setConfirmPay(false);await load()}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo registrar el pago.')}}}><Text style={ui.text}>Confirmar pago</Text></Pressable></View></Card>:<Pressable style={ui.button} onPress={()=>setConfirmPay(true)}><Text style={ui.buttonText}>Pago completo</Text></Pressable>)}
      <Field label="Importe" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <View style={ui.row}>
        <Pressable style={[ui.button, { flex: 1 }]} onPress={() => movement('payment')}><Text style={ui.buttonText}>Registrar cobro</Text></Pressable>
        <Pressable style={[ui.secondaryButton, { flex: 1 }]} onPress={() => movement('refund')}><Text style={ui.buttonText}>Reembolso</Text></Pressable>
      </View>
      {payments.map(payment => <Card key={payment.id}><View style={ui.row}><Text style={ui.text}>{payment.kind === 'payment' ? 'Cobro' : 'Reembolso'}</Text><Money value={payment.amount} color={payment.kind === 'payment' ? colors.green : colors.danger} /></View><Text style={ui.label}>{payment.transactionDate}</Text>{confirmPayment===payment.id?<View style={ui.row}><Pressable onPress={()=>setConfirmPayment(null)}><Text style={ui.label}>Cancelar</Text></Pressable><Pressable onPress={async()=>{try{await deletePayment(payment);setConfirmPayment(null);await load()}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo quitar el movimiento.')}}}><Text style={ui.error}>Confirmar quitar</Text></Pressable></View>:<Pressable onPress={()=>setConfirmPayment(payment.id)}><Text style={ui.label}>Quitar movimiento</Text></Pressable>}</Card>)}
      <Text style={ui.section}>Gastos</Text>
      <Field label="Concepto" value={concept} onChangeText={setConcept} />
      <Text style={ui.label}>Categoría de gasto</Text>
      {EXPENSE_CATEGORIES.map(category=><Pressable key={category} accessibilityRole="radio" accessibilityState={{selected:expenseCategory===category}} onPress={()=>setExpenseCategory(category)}><Text style={[ui.label,expenseCategory===category&&{color:colors.orange}]}>{expenseCategory===category?'●':'○'} {category}</Text></Pressable>)}
      <Field label="Importe del gasto" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Pressable style={ui.button} onPress={async () => { try { await addExpense(event.id, { name: concept, category:expenseCategory, amount: Number(amount).toFixed(2), expenseDate: new Date().toISOString().slice(0, 10) }); setConcept(''); setAmount(''); await load() } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.') } }}><Text style={ui.buttonText}>Agregar gasto</Text></Pressable>
      {expenses.map(expense => <Card key={expense.id}><View style={ui.row}><Text style={ui.text}>{expense.name}</Text><Money value={expense.amount} /></View><Text style={ui.label}>{expense.source === 'payroll' ? 'Originado en nómina' : expense.category}</Text></Card>)}
      <Text style={ui.section}>Eliminar evento</Text>
      {confirmEvent?<Card><Text style={ui.text}>¿Eliminar este evento? Desaparecerá de la agenda y los reportes.</Text><View style={ui.row}><Pressable onPress={()=>setConfirmEvent(false)}><Text style={ui.label}>Cancelar</Text></Pressable><Pressable onPress={async()=>{try{await deleteEvent(event);router.replace('/(tabs)/events')}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo eliminar.')}}}><Text style={ui.error}>Sí, eliminar</Text></Pressable></View></Card>:<Pressable style={ui.secondaryButton} onPress={()=>setConfirmEvent(true)}><Text style={ui.buttonText}>Eliminar evento</Text></Pressable>}
    </>}
    {error && <Text style={ui.error}>{error}</Text>}
  </Screen>
}
