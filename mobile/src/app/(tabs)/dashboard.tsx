import {useMemo} from 'react'
import {Pressable,Text} from 'react-native'
import {Card,Money,Screen,ui} from '../../components'
import {useSession} from '../../session'
import {useFinancialPeriod} from '../../financial-period'
import {useFinancialData} from '../../use-financial-data'
import {financialModel} from '../../finance-model'
import {FinancialPeriodControl,WeeklyCashChart,formatMoney} from '../../financial-components'
import {colors} from '../../theme'

export default function Dashboard(){
  const {user,businessScope}=useSession()
  const {data,loading,error,reload}=useFinancialData()
  const {period,ready}=useFinancialPeriod()
  const model=useMemo(()=>financialModel(data,businessScope,period),[data,businessScope,period])
  if(user?.role==='coordinator')return <Screen title="Panel general"><Text style={ui.error}>No tienes acceso a Panel general.</Text></Screen>
  return <Screen title="Panel general" loading={loading||!ready}>
    <FinancialPeriodControl/>
    {error?<><Text style={ui.error}>{error}</Text><Pressable style={ui.secondaryButton} onPress={()=>void reload()}><Text style={ui.buttonText}>Reintentar</Text></Pressable></>:<>
      <Card><Text style={ui.label}>Entradas del periodo</Text><Money value={model.incoming} color={colors.green}/><Text style={ui.label}>Eventos y utilidades cobradas. Devoluciones: {formatMoney(model.refunds)}.</Text></Card>
      <Card><Text style={ui.label}>Gastos pagados</Text><Money value={model.paid} color={colors.orange}/><Text style={ui.label}>Incluye sueldos, costos laborales y gastos.</Text></Card>
      <Card><Text style={ui.label}>Ganancias del periodo</Text><Money value={model.cashResult}/><Text style={ui.label}>Cobros netos después de devoluciones menos pagos.</Text></Card>
      <Card><Text style={ui.label}>Saldo por cobrar</Text><Money value={model.receivable}/></Card>
      <WeeklyCashChart points={model.weekly}/>
    </>}
  </Screen>
}
