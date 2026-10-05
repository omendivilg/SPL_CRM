import {useMemo,useState} from 'react'
import {Pressable,ScrollView,StyleSheet,Text,View} from 'react-native'
import {router} from 'expo-router'
import {Card,Field,Money,Screen,ui} from '../../components'
import {deleteDirectIncome,receiveDirectIncome,type DirectIncome} from '../../api'
import {colors} from '../../theme'
import {useSession} from '../../session'
import {financialModel,type ExpenseState} from '../../finance-model'
import {useFinancialData} from '../../use-financial-data'
import {todayLocal,useFinancialPeriod,validDate} from '../../financial-period'
import {CategoryBars,FinancialPeriodControl,formatMoney} from '../../financial-components'

export default function Finance(){
  const {businessScope,user}=useSession()
  const {data,loading,error,reload}=useFinancialData()
  const {period,ready}=useFinancialPeriod()
  const model=useMemo(()=>financialModel(data,businessScope,period),[data,businessScope,period])
  const [expenseState,setExpenseState]=useState<ExpenseState>('Pagados'),[category,setCategory]=useState('Todas'),[expanded,setExpanded]=useState(false)
  const selectedCategory=category==='Todas'||model.categories(expenseState).some(item=>item.name===category)?category:'Todas'
  const [dates,setDates]=useState<Record<string,string>>({}),[confirmDelete,setConfirmDelete]=useState<string|null>(null),[busyId,setBusyId]=useState<string|null>(null),[actionError,setActionError]=useState('')
  const changeIncome=async(item:DirectIncome,action:'receive'|'delete')=>{
    setActionError('');setBusyId(item.id)
    try{
      if(action==='receive'){
        const date=dates[item.id]??todayLocal()
        if(!validDate(date))throw new Error('Usa una fecha válida en formato AAAA-MM-DD.')
        await receiveDirectIncome(item,date)
      }else await deleteDirectIncome(item)
      setConfirmDelete(null);await reload()
    }catch(cause){setActionError(cause instanceof Error?cause.message:'No se pudo cambiar la utilidad.')}
    finally{setBusyId(null)}
  }
  if(user?.role==='coordinator')return <Screen title="Finanzas"><Text style={ui.error}>No tienes acceso a Finanzas.</Text></Screen>
  return <Screen title="Finanzas" loading={loading||!ready}>
    <FinancialPeriodControl/>
    {(error||actionError)&&<Text style={ui.error}>{error||actionError}</Text>}
    {error?<Pressable style={ui.secondaryButton} onPress={()=>void reload()}><Text style={ui.buttonText}>Reintentar</Text></Pressable>:<>
      <Card><Text style={ui.label}>Ingresos acordados y utilidades</Text><Money value={model.projected}/><Text style={ui.label}>{model.events.length} eventos · {model.income.length} utilidades en el periodo.</Text></Card>
      <View style={styles.metrics}><Card><Text style={ui.label}>Por cobrar</Text><Money value={model.receivable}/></Card><Card><Text style={ui.label}>Por pagar al cierre</Text><Money value={model.payable} color={colors.danger}/></Card></View>
      <Card>
        <Text style={ui.section}>Resultado completo</Text>
        <View style={ui.row}><Text style={styles.rowLabel}>Ingresos acordados y utilidades</Text><Money value={model.projected}/></View>
        <View style={ui.row}><Text style={styles.rowLabel}>Sueldos y costos laborales</Text><Money value={-model.wageCost||0} color={colors.danger}/></View>
        <View style={ui.row}><Text style={styles.rowLabel}>Gastos registrados</Text><Money value={-model.expenseCost||0} color={colors.danger}/></View>
        <View style={[ui.row,styles.total]}><Text style={styles.rowLabel}>Resultado previsto</Text><Money value={model.result} color={model.result<0?colors.danger:colors.text}/></View>
        <Text style={ui.label}>Incluye sueldos y costos de almacén en sus fechas previstas.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={expanded?'Ocultar entradas por fecha':'Desplegar entradas por fecha'} accessibilityState={{expanded}} onPress={()=>setExpanded(value=>!value)} style={styles.expand}><Text style={ui.label}>Entradas por fecha</Text><Text style={styles.expandArrow}>{expanded?'⌃':'⌄'}</Text></Pressable>
        {expanded&&<View style={styles.ledger}>
          <Text style={ui.section}>Entradas del periodo</Text>
          {!model.ledger.length?<Text style={ui.empty}>No hay entradas en este periodo.</Text>:model.ledger.map(row=><View key={row.id} style={styles.ledgerRow}>
            <View style={ui.row}><Text style={styles.rowLabel}>{row.name}</Text><Money value={row.amount} color={row.pending?colors.muted:row.amount<0?colors.danger:colors.green}/></View>
            <Text style={ui.label}>{row.date} · {row.origin} · {row.businessUnit}</Text>
            {row.pending&&<Text style={[ui.label,{color:colors.danger}]}>Pendiente al cierre. No incluida en cobros.</Text>}
            {row.notes?<Text style={ui.label}>{row.notes}</Text>:null}
          </View>)}
          <View style={ui.row}><Text style={ui.label}>Entradas recibidas</Text><Money value={model.incoming} color={colors.green}/></View>
          <View style={ui.row}><Text style={ui.label}>Devoluciones</Text><Money value={-model.refunds||0} color={colors.danger}/></View>
          <View style={ui.row}><Text style={ui.label}>Cobros netos</Text><Money value={model.collected}/></View>
        </View>}
      </Card>
      <View style={ui.row}><Text style={ui.section}>Utilidades sin evento</Text><Pressable accessibilityRole="button" accessibilityLabel="Nueva utilidad" style={styles.add} onPress={()=>router.push('/income/new')}><Text style={[ui.buttonText,{color:colors.orange}]}>+ Nueva</Text></Pressable></View>
      {!model.income.length?<Text style={ui.empty}>No hay utilidades en este periodo.</Text>:model.income.map(item=>{
        const receivedAsOf=Boolean(item.receivedDate&&item.receivedDate<=period.end)
        return <Card key={item.id}>
          <View style={ui.row}><Text style={styles.rowLabel}>{item.name}</Text><Money value={item.amount} color={receivedAsOf?colors.green:colors.text}/></View>
          <Text style={ui.label}>{item.businessUnit} · {receivedAsOf?`Cobrado ${item.receivedDate}`:`Pendiente para ${item.expectedDate}`}</Text>
          {item.notes?<Text style={ui.label}>Notas: {item.notes}</Text>:null}
          {!item.receivedDate&&<><Field label="Fecha real de cobro (AAAA-MM-DD)" value={dates[item.id]??todayLocal()} onChangeText={value=>setDates(current=>({...current,[item.id]:value}))}/><Pressable disabled={busyId===item.id} style={ui.button} onPress={()=>void changeIncome(item,'receive')}><Text style={ui.buttonText}>Marcar como cobrada</Text></Pressable></>}
          {confirmDelete===item.id?<View style={styles.confirm}><Text style={ui.label}>¿Eliminar esta utilidad?</Text><View style={ui.row}><Pressable style={ui.secondaryButton} onPress={()=>setConfirmDelete(null)}><Text style={ui.buttonText}>Cancelar</Text></Pressable><Pressable disabled={busyId===item.id} style={ui.secondaryButton} onPress={()=>void changeIncome(item,'delete')}><Text style={[ui.buttonText,{color:colors.danger}]}>Eliminar</Text></Pressable></View></View>:<Pressable style={styles.remove} onPress={()=>setConfirmDelete(item.id)}><Text style={ui.label}>Eliminar utilidad</Text></Pressable>}
        </Card>
      })}
      <Card>
        <Text style={ui.section}>Detalle de gastos</Text>
        <Text style={ui.label}>Gastos de eventos, directos y de nómina. Los sueldos están en Resultado completo.</Text>
        <View style={styles.filters}>{(['Pagados','Pendientes','Todos'] as const).map(state=><Pressable key={state} accessibilityRole="radio" accessibilityState={{selected:expenseState===state}} style={[ui.secondaryButton,styles.state,expenseState===state&&{borderColor:colors.orange}]} onPress={()=>setExpenseState(state)}><Text style={styles.stateText}>{state}</Text></Pressable>)}</View>
        <Text style={ui.label}>{expenseState==='Pagados'?'Pagos realizados dentro del periodo seleccionado.':expenseState==='Pendientes'?'Saldo pendiente al cierre del periodo.':'Pagos del periodo y saldo pendiente al cierre.'}</Text>
        <CategoryBars items={model.categories(expenseState)}/>
        <Text style={ui.label}>Todas las categorías de pago. Desliza la gráfica para verlas.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{gap:8,paddingVertical:8}}>{['Todas',...model.categories(expenseState).map(item=>item.name)].map(name=><Pressable key={name} accessibilityRole="radio" accessibilityState={{selected:selectedCategory===name}} onPress={()=>setCategory(name)} style={[ui.secondaryButton,selectedCategory===name&&{borderColor:colors.orange}]}><Text style={ui.buttonText}>{name}</Text></Pressable>)}</ScrollView>
      </Card>
      {!model.expenseRows(expenseState,selectedCategory).length?<Text style={ui.empty}>No hay gastos con estos filtros.</Text>:model.expenseRows(expenseState,selectedCategory).map(detail=><Card key={detail.id}>
        <View style={ui.row}><Text style={styles.rowLabel}>{detail.name}</Text><Money value={expenseState==='Pagados'?detail.paidInPeriod:expenseState==='Pendientes'?detail.pending:detail.amount} color={colors.danger}/></View>
        <Text style={ui.label}>{detail.origin} · {detail.category} · {detail.businessUnit}</Text><Text style={ui.label}>Registro: {detail.date} · Total: {formatMoney(detail.amount)}</Text>
        <Text style={ui.label}>Pagado en el periodo: {formatMoney(detail.paidInPeriod)} · Pendiente al cierre: {formatMoney(detail.pending)}</Text>
        {expenseState!=='Pendientes'&&detail.payments.filter(payment=>payment.date>=period.start&&payment.date<=period.end).map((payment,index)=><Text style={ui.label} key={`${payment.date}:${index}`}>Pago {payment.date}: {formatMoney(payment.amount)}</Text>)}
        {detail.origin==='Gasto directo'&&<Text style={ui.label}>Forma de pago: {detail.paymentMethod==='cash'?'Efectivo':detail.paymentMethod==='card'?'Tarjeta':'Sin especificar'}</Text>}
        {detail.notes?<Text style={ui.label}>Notas: {detail.notes}</Text>:null}
      </Card>)}
    </>}
  </Screen>
}
const styles=StyleSheet.create({metrics:{gap:12},rowLabel:{color:colors.muted,fontSize:14,lineHeight:22,flex:1},total:{borderTopWidth:1,borderColor:colors.border,paddingTop:12,marginTop:4},expand:{alignSelf:'flex-end',minHeight:48,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:8},expandArrow:{color:colors.text,fontSize:24,lineHeight:30},ledger:{borderTopWidth:1,borderColor:colors.border,paddingTop:12,gap:12},ledgerRow:{gap:5,borderBottomWidth:1,borderColor:colors.border,paddingBottom:12},add:{minHeight:48,minWidth:64,alignItems:'center',justifyContent:'center'},remove:{minHeight:48,alignSelf:'flex-start',justifyContent:'center'},confirm:{gap:10},filters:{flexDirection:'row',gap:6,flexWrap:'wrap'},state:{minHeight:48,paddingHorizontal:10,flexGrow:1},stateText:{color:colors.text,fontSize:14,fontWeight:'600'}})
