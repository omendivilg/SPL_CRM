import {Decimal} from 'decimal.js'

export type FinanceEvent={price:number|null;payrollActual:number;payrollBudget:number;expenseBudget:number;payments:Array<{amount:number;kind?:'payment'|'refund'}>;expenses:Array<{amount:number;paid:number}>}
export type FinanceSummary={agreed:string;received:string;expenses:string;payroll:string;contribution:string;receivable:string;payable:string}
const total=(values:Decimal[])=>values.reduce((sum,value)=>sum.plus(value),new Decimal(0))
export function calculateFinanceSummary(events:FinanceEvent[]):FinanceSummary{
  const agreed=total(events.map(event=>new Decimal(event.price??0)))
  const received=total(events.flatMap(event=>event.payments.map(payment=>new Decimal(payment.amount).times(payment.kind==='refund'?-1:1))))
  const expenses=total(events.flatMap(event=>event.expenses.map(expense=>new Decimal(expense.amount))))
  const payroll=total(events.map(event=>new Decimal(event.payrollActual)))
  const payable=total(events.flatMap(event=>event.expenses.map(expense=>Decimal.max(new Decimal(expense.amount).minus(expense.paid),0))))
  const fixed=(value:Decimal)=>value.toFixed(2)
  return{agreed:fixed(agreed),received:fixed(received),expenses:fixed(expenses),payroll:fixed(payroll),contribution:fixed(agreed.minus(expenses).minus(payroll)),receivable:fixed(Decimal.max(agreed.minus(received),0)),payable:fixed(payable)}
}
