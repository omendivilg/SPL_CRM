import {amountInPeriod,inPeriod,type DashboardPeriod} from '../../src/dashboard/period'
import {weeklySeries,type DatedAmount} from '../../src/dashboard/weekly'
import {EXPENSE_CATEGORIES} from '../../src/expense-categories'
import {allocatePayrollCents,payrollAllocationUnit} from '../../src/payroll/cash-allocation'
import type {DirectIncome,EventRecord,Expense,ExpenseSettlement,LegacyPayroll,Payment,Payroll,QuickExpense} from './api'
import type {BusinessScope} from './session'

export type FinancialData={events:EventRecord[];income:DirectIncome[];payroll:Payroll[];quick:QuickExpense[];expenses:{event:EventRecord;expense:Expense}[];payments:{event:EventRecord;payment:Payment}[];settlements:ExpenseSettlement[];legacy:LegacyPayroll}
export type ExpenseState='Pagados'|'Pendientes'|'Todos'
export type ExpenseDetail={id:string;name:string;origin:string;category:string;date:string;amount:number;payments:DatedAmount[];notes:string;paymentMethod:'cash'|'card'|null;businessUnit:'SPL'|'5to Elemento';paidInPeriod:number;paidAsOf:number;pending:number}
export type IncomeRow={id:string;name:string;origin:string;date:string;amount:number;pending:boolean;notes:string;businessUnit:'SPL'|'5to Elemento'}
export const emptyFinancialData=():FinancialData=>({events:[],income:[],payroll:[],quick:[],expenses:[],payments:[],settlements:[],legacy:{entries:[],settlements:[]}})
export const sumAmounts=(values:number[])=>values.reduce((sum,value)=>sum+Math.round(value*100),0)/100
const visible=(unit:'SPL'|'5to Elemento',scope:BusinessScope)=>scope==='Todos'||unit===scope
const numeric=(amount:string)=>Number(amount)
const upTo=(values:DatedAmount[],cutoff:string)=>sumAmounts(values.filter(value=>value.date<=cutoff).map(value=>value.amount))
const expenseValue=(detail:ExpenseDetail,state:ExpenseState)=>state==='Pagados'?detail.paidInPeriod:state==='Pendientes'?detail.pending:sumAmounts([detail.paidInPeriod,detail.pending])

export function financialModel(data:FinancialData,scope:BusinessScope,period:DashboardPeriod){
  const events=data.events.filter(event=>visible(event.businessUnit,scope))
  const income=data.income.filter(item=>!item.deletedAt&&visible(item.businessUnit,scope))
  const batches=data.payroll.filter(batch=>visible(batch.businessUnit,scope))
  const eventUnits=new Map(data.events.map(event=>[event.id,event.businessUnit]))
  const activePayment=(batch:Payroll)=>batch.payments?.findLast(payment=>!payment.reversedAt)
  const paidBatch=(batch:Payroll,amount:number):DatedAmount[]=>{const payment=activePayment(batch);return payment?[{date:payment.paymentDate,amount}]:[]}
  const expenses=([
    ...data.expenses.filter(({event,expense})=>expense.source!=='payroll'&&visible(event.businessUnit,scope)).map(({event,expense})=>({id:`event:${expense.id}`,name:expense.name,origin:`Evento: ${event.clientName}`,category:expense.category,date:expense.expenseDate,amount:numeric(expense.amount),payments:data.settlements.filter(payment=>payment.expenseId===expense.id).map(payment=>({date:payment.paymentDate,amount:numeric(payment.amount)})),notes:expense.notes??'',paymentMethod:null,businessUnit:event.businessUnit})),
    ...data.quick.filter(expense=>visible(expense.businessUnit,scope)).map(expense=>({id:`quick:${expense.id}`,name:expense.name,origin:'Gasto directo',category:expense.category,date:expense.expenseDate,amount:numeric(expense.amount),payments:[{date:expense.expenseDate,amount:numeric(expense.amount)}],notes:expense.notes??'',paymentMethod:expense.paymentMethod,businessUnit:expense.businessUnit})),
    ...batches.flatMap(batch=>batch.expenses.map(expense=>({id:`payroll:${batch.id}:${expense.id}`,name:expense.concept,origin:`Nómina: ${batch.name||`${batch.periodStart} al ${batch.periodEnd}`}`,category:expense.category,date:batch.periodEnd,amount:numeric(expense.amount),payments:paidBatch(batch,numeric(expense.amount)),notes:expense.notes??'',paymentMethod:null,businessUnit:batch.businessUnit})))
  ] as Omit<ExpenseDetail,'paidInPeriod'|'paidAsOf'|'pending'>[]).map(expense=>{
    const paidAsOf=Math.min(expense.amount,upTo(expense.payments,period.end))
    return {...expense,paidInPeriod:amountInPeriod(expense.payments,period),paidAsOf,pending:expense.date<=period.end?Math.max(0,sumAmounts([expense.amount,-paidAsOf])):0}
  })
  const weeklyLineIds=new Set(data.payroll.flatMap(batch=>batch.lines.map(line=>line.id)))
  const legacy=data.legacy.entries.filter(entry=>!entry.archivedDraft&&!weeklyLineIds.has(entry.id))
  const legacyCosts=legacy.flatMap(entry=>{
    const weights=entry.allocations.map(allocation=>allocation.amount)
    const settlements=data.legacy.settlements.filter(payment=>payment.payrollEntryId===entry.id)
    const allocatedNet=allocatePayrollCents(entry.netPay,weights)
    const remaining=Math.max(0,sumAmounts([numeric(entry.netPay),-sumAmounts(settlements.filter(payment=>payment.paymentDate<=period.end).map(payment=>numeric(payment.amount)))]))
    const allocatedRemaining=allocatePayrollCents(remaining,weights)
    const allocatedPayments=settlements.map(payment=>({date:payment.paymentDate,amounts:allocatePayrollCents(payment.amount,weights)}))
    return entry.allocations.flatMap((allocation,index)=>{
      const unit=payrollAllocationUnit(allocation,eventUnits)
      if(!visible(unit,scope))return []
      return [{id:`legacy:${entry.id}:${index}`,date:entry.periodEnd,amount:numeric(allocation.amount),payableAmount:allocatedNet[index],pendingAtCutoff:allocatedRemaining[index],payments:allocatedPayments.map(payment=>({date:payment.date,amount:payment.amounts[index]}))}]
    })
  })
  const wages:{date:string;amount:number;payableAmount:number;payments:DatedAmount[];pendingAtCutoff?:number}[]=[...batches.flatMap(batch=>batch.lines.map(line=>({date:batch.periodEnd,amount:numeric(line.laborCost??line.netPay),payableAmount:numeric(line.netPay),payments:paidBatch(batch,numeric(line.netPay))}))),...legacyCosts]
  const actualIncome:IncomeRow[]=[
    ...data.payments.filter(({event})=>visible(event.businessUnit,scope)).map(({event,payment})=>({id:`event:${payment.id}`,name:event.clientName,origin:payment.kind==='refund'?'Devolución de evento':'Cobro de evento',date:payment.transactionDate,amount:numeric(payment.amount)*(payment.kind==='refund'?-1:1),pending:false,notes:'',businessUnit:event.businessUnit})),
    ...income.filter(item=>item.receivedDate).map(item=>({id:`income:${item.id}`,name:item.name,origin:'Utilidad',date:item.receivedDate!,amount:numeric(item.amount),pending:false,notes:item.notes??'',businessUnit:item.businessUnit}))
  ]
  const outstandingEvent=(event:EventRecord)=>Math.max(0,sumAmounts([numeric(event.agreedPrice??'0'),-sumAmounts(data.payments.filter(({event:source,payment})=>source.id===event.id&&payment.transactionDate<=period.end).map(({payment})=>numeric(payment.amount)*(payment.kind==='refund'?-1:1)))]))
  const expectedEvents=events.filter(event=>inPeriod(event.eventDate,period))
  const pendingEvents:IncomeRow[]=expectedEvents.filter(event=>outstandingEvent(event)>0).map(event=>({id:`pending-event:${event.id}`,name:event.clientName,origin:'Evento previsto',date:event.eventDate,amount:outstandingEvent(event),pending:true,notes:'',businessUnit:event.businessUnit}))
  const pendingIncome=income.filter(item=>!item.receivedDate||item.receivedDate>period.end).filter(item=>inPeriod(item.expectedDate,period)).map(item=>({id:`pending:${item.id}`,name:item.name,origin:'Utilidad prevista',date:item.expectedDate,amount:numeric(item.amount),pending:true,notes:item.notes??'',businessUnit:item.businessUnit}))
  const ledger=[...actualIncome.filter(item=>inPeriod(item.date,period)),...pendingEvents,...pendingIncome].sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name))
  const expectedIncome=income.filter(item=>inPeriod(item.receivedDate&&item.receivedDate<=period.end?item.receivedDate:item.expectedDate,period))
  const projected=sumAmounts([...expectedEvents.map(event=>numeric(event.agreedPrice??'0')),...expectedIncome.map(item=>numeric(item.amount))])
  const wageCost=amountInPeriod(wages,period)
  const expenseCost=amountInPeriod(expenses,period)
  const cashWages=wages.flatMap(wage=>wage.payments)
  const cashExpenses=expenses.flatMap(expense=>expense.payments)
  const collected=amountInPeriod(actualIncome,period)
  const paid=sumAmounts([amountInPeriod(cashExpenses,period),amountInPeriod(cashWages,period)])
  const receivable=sumAmounts([
    ...events.filter(event=>event.eventDate<=period.end).map(outstandingEvent),
    ...income.filter(item=>item.expectedDate<=period.end&&(!item.receivedDate||item.receivedDate>period.end)).map(item=>numeric(item.amount))
  ])
  const payable=sumAmounts([...expenses.map(expense=>expense.pending),...wages.filter(wage=>wage.date<=period.end).map(wage=>wage.pendingAtCutoff??Math.max(0,wage.payableAmount-upTo(wage.payments,period.end)))])
  const incoming=amountInPeriod(actualIncome.filter(row=>row.amount>0),period)
  const refunds=-amountInPeriod(actualIncome.filter(row=>row.amount<0),period)
  const categories=[...EXPENSE_CATEGORIES,...[...new Set(expenses.map(expense=>expense.category))].filter(category=>!(EXPENSE_CATEGORIES as readonly string[]).includes(category)).sort((a,b)=>a.localeCompare(b,'es'))]
  return {events:expectedEvents,income:expectedIncome,expenses,wageCost,expenseCost,projected,collected,incoming,refunds,receivable,payable,paid,result:sumAmounts([projected,-wageCost,-expenseCost]),cashResult:sumAmounts([collected,-paid]),ledger,
    categories:(state:ExpenseState)=>categories.map(name=>({name,amount:sumAmounts(expenses.filter(expense=>expense.category===name).map(expense=>expenseValue(expense,state)))})),
    expenseRows:(state:ExpenseState,category:string)=>expenses.filter(expense=>(category==='Todas'||expense.category===category)&&(expenseValue(expense,state)>0||(state==='Todos'&&inPeriod(expense.date,period)))).sort((a,b)=>b.date.localeCompare(a.date)||a.name.localeCompare(b.name)),
    weekly:weeklySeries(actualIncome.filter(item=>item.date<=period.end),cashExpenses.concat(cashWages).filter(item=>item.date<=period.end),cashWages.filter(item=>item.date<=period.end),period.end)
  }
}
