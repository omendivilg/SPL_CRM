import {describe,expect,it} from 'vitest'
import {dashboardPeriod} from '../../src/dashboard/period'
import {emptyFinancialData,financialModel} from './finance-model'
import type {DirectIncome,EventRecord,Payroll} from './api'

const event:EventRecord={id:'event',version:1,clientName:'Evento de prueba',venue:'Salón',eventDate:'2026-09-23',businessUnit:'SPL',agreedPrice:'1000.00',operationalStatus:'Confirmado'}
const period=dashboardPeriod('2026-09-23','week')
const utility=(values:Partial<DirectIncome>={}):DirectIncome=>({id:'utility',name:'Renta independiente',amount:'200.00',expectedDate:'2026-09-23',receivedDate:null,businessUnit:'SPL',version:1,createdBy:'test',createdAt:'2026-09-23T12:00:00Z',...values})
const batch=(values:Partial<Payroll>={}):Payroll=>({id:'batch',version:1,businessUnit:'SPL',periodStart:'2026-09-22',periodEnd:'2026-09-28',status:'paid',total:'110.00',lines:[{id:'worker',employeeName:'Trabajador',laborCost:'100.00',netPay:'90.00'}],expenses:[{id:'extra',concept:'Transporte de almacén',category:'Transporte',amount:'20.00',scope:'warehouse'}],payments:[{id:'paid',paymentDate:'2026-09-27',amount:'110.00'}],...values})

describe('mobile financial model',()=>{
  it('lists the outstanding portion of selected-period events as pending entries without increasing cash receipts',()=>{
    const older={...event,id:'older',eventDate:'2026-09-10',agreedPrice:'100.00'}
    const data=emptyFinancialData();data.events=[event,older]
    data.payments=[{event,payment:{id:'paid',kind:'payment',amount:'400.00',transactionDate:'2026-09-23',version:1}},{event,payment:{id:'refund',kind:'refund',amount:'50.00',transactionDate:'2026-09-24',version:1}},{event,payment:{id:'future',kind:'payment',amount:'650.00',transactionDate:'2026-09-30',version:1}}]
    const model=financialModel(data,'SPL',period)
    expect(model.ledger.filter(row=>row.pending)).toEqual([expect.objectContaining({date:'2026-09-23',amount:650,origin:'Evento previsto',name:'Evento de prueba'})])
    expect(model.collected).toBe(350);expect(model.receivable).toBe(750)
  })
  it('includes older unpaid events and utilities in the scoped closing receivable balance and excludes future obligations',()=>{
    const older={...event,eventDate:'2026-09-10',agreedPrice:'100.00'}
    const future={...event,id:'future',eventDate:'2026-10-02',agreedPrice:'300.00'}
    const fifth={...event,id:'fifth',eventDate:'2026-09-10',businessUnit:'5to Elemento' as const,agreedPrice:'80.00'}
    const data=emptyFinancialData();data.events=[older,future,fifth]
    data.income=[utility({amount:'50.00',expectedDate:'2026-09-10'}),utility({id:'received-later',amount:'25.00',expectedDate:'2026-09-11',receivedDate:'2026-10-02'}),utility({id:'future-utility',amount:'400.00',expectedDate:'2026-10-02'}),utility({id:'fifth-utility',amount:'20.00',expectedDate:'2026-09-10',businessUnit:'5to Elemento'})]
    expect(financialModel(data,'SPL',period).receivable).toBe(175)
    expect(financialModel(data,'5to Elemento',period).receivable).toBe(100)
    expect(financialModel(data,'Todos',period).receivable).toBe(275)
    data.payments=[{event:older,payment:{id:'paid-after',kind:'payment',amount:'100.00',transactionDate:'2026-10-02',version:1}},{event:older,payment:{id:'partial',kind:'payment',amount:'30.00',transactionDate:'2026-09-25',version:1}},{event:older,payment:{id:'refund',kind:'refund',amount:'10.00',transactionDate:'2026-09-26',version:1}}]
    expect(financialModel(data,'SPL',period).receivable).toBe(155)
  })
  it('preserves exact settlement cents across three legacy allocations and company subtotals',()=>{
    const fifth={...event,id:'fifth',businessUnit:'5to Elemento' as const}
    const data=emptyFinancialData();data.events=[event,fifth]
    data.legacy.entries=[{id:'legacy',employeeName:'Legacy',periodStart:'2026-09-22',periodEnd:'2026-09-28',laborCost:'100.00',netPay:'99.99',allocations:[{scope:'event',eventId:'event',amount:'33.33'},{scope:'event',eventId:'fifth',amount:'33.33'},{scope:'warehouse',amount:'33.34'}]}]
    data.legacy.settlements=[{id:'paid',payrollEntryId:'legacy',paymentDate:'2026-09-25',amount:'99.99'}]
    const all=financialModel(data,'Todos',period),spl=financialModel(data,'SPL',period),fifthModel=financialModel(data,'5to Elemento',period)
    expect(all.paid).toBe(99.99);expect(all.payable).toBe(0)
    expect(Number((spl.paid+fifthModel.paid).toFixed(2))).toBe(99.99)
    expect(spl.payable+fifthModel.payable).toBe(0)
  })
  it('keeps partial settlement and remaining debt cents exact without phantom balances after final payment',()=>{
    const fifth={...event,id:'fifth',businessUnit:'5to Elemento' as const}
    const data=emptyFinancialData();data.events=[event,fifth]
    data.legacy.entries=[{id:'legacy',employeeName:'Legacy',periodStart:'2026-09-22',periodEnd:'2026-09-28',laborCost:'3.00',netPay:'1.00',allocations:[{scope:'event',eventId:'event',amount:'1.00'},{scope:'event',eventId:'fifth',amount:'1.00'},{scope:'warehouse',amount:'1.00'}]}]
    data.legacy.settlements=[{id:'first-half',payrollEntryId:'legacy',paymentDate:'2026-09-25',amount:'0.50'},{id:'last-half',payrollEntryId:'legacy',paymentDate:'2026-09-30',amount:'0.50'}]
    const partial=financialModel(data,'Todos',period)
    expect(partial).toMatchObject({paid:0.5,payable:0.5})
    const fullPeriod=dashboardPeriod('2026-09-23','month')
    expect(financialModel(data,'Todos',fullPeriod)).toMatchObject({paid:1,payable:0})
    expect(financialModel(data,'SPL',fullPeriod).payable).toBe(0)
    expect(financialModel(data,'5to Elemento',fullPeriod).payable).toBe(0)
  })
  it('recognizes expense cash at actual settlement dates and keeps accrued costs on registration date',()=>{
    const data=emptyFinancialData();data.events=[event]
    data.expenses=[{event,expense:{id:'expense',name:'Renta',category:'Renta de equipo',expenseDate:'2026-09-10',amount:'100.00',paidAmount:'100.00'}}]
    data.settlements=[{id:'before',expenseId:'expense',paymentDate:'2026-09-20',amount:'30.00'},{id:'within',expenseId:'expense',paymentDate:'2026-09-25',amount:'40.00'},{id:'future',expenseId:'expense',paymentDate:'2026-10-02',amount:'30.00'}]
    const model=financialModel(data,'Todos',period)
    expect(model.expenseCost).toBe(0);expect(model.paid).toBe(40)
    expect(model.expenses[0]).toMatchObject({paidInPeriod:40,paidAsOf:70,pending:30})
    expect(model.categories('Pagados').find(item=>item.name==='Renta de equipo')?.amount).toBe(40)
    expect(model.categories('Pendientes').find(item=>item.name==='Renta de equipo')?.amount).toBe(30)
  })
  it('keeps future-received utilities pending at a historic cutoff and preserves notes',()=>{
    const data=emptyFinancialData();data.income=[utility({receivedDate:'2026-10-02',notes:'Pago de equipo'})]
    const historic=financialModel(data,'Todos',period)
    expect(historic.projected).toBe(200);expect(historic.receivable).toBe(200);expect(historic.collected).toBe(0)
    expect(historic.ledger).toEqual([expect.objectContaining({date:'2026-09-23',pending:true,notes:'Pago de equipo'})])
    const received=financialModel(data,'Todos',dashboardPeriod('2026-10-02','week'))
    expect(received.projected).toBe(200);expect(received.collected).toBe(200);expect(received.receivable).toBe(0)
    expect(received.ledger).toHaveLength(1);expect(received.ledger[0].pending).toBe(false)
  })
  it('separates gross incoming receipts from net receipts and profits after refunds',()=>{
    const data=emptyFinancialData();data.events=[event];data.income=[utility({receivedDate:'2026-09-24'})]
    data.payments=[{event,payment:{id:'payment',kind:'payment',amount:'400.00',transactionDate:'2026-09-23',version:1}},{event,payment:{id:'refund',kind:'refund',amount:'50.00',transactionDate:'2026-09-24',version:1}}]
    data.quick=[{id:'quick',name:'Flete',category:'Transporte',amount:'100.00',expenseDate:'2026-09-24',businessUnit:'SPL',notes:'',paymentMethod:'cash',createdBy:'test',createdAt:''}]
    const model=financialModel(data,'Todos',period)
    expect(model.incoming).toBe(600);expect(model.refunds).toBe(50);expect(model.collected).toBe(550);expect(model.cashResult).toBe(450)
    expect(model.weekly.at(-1)).toMatchObject({incoming:600,refunds:50,received:550,expenses:100,profit:450})
    expect(model.ledger.find(row=>row.id==='event:refund')?.amount).toBe(-50)
  })
  it('includes gross wages and warehouse expenses once, with net cash after deductions and no phantom payable balance',()=>{
    const data=emptyFinancialData();data.events=[event];data.payroll=[batch()]
    data.expenses=[{event,expense:{id:'projected-extra',name:'Duplicated payroll projection',category:'Transporte',expenseDate:'2026-09-28',amount:'20.00',paidAmount:'20.00',source:'payroll'}}]
    data.legacy.entries=[{id:'worker',employeeName:'Duplicate',periodStart:'2026-09-22',periodEnd:'2026-09-28',laborCost:'100.00',netPay:'90.00',allocations:[{scope:'warehouse',amount:'100.00'}]},{id:'archive',employeeName:'Draft',periodStart:'2026-09-22',periodEnd:'2026-09-28',laborCost:'100.00',netPay:'100.00',archivedDraft:true,allocations:[{scope:'warehouse',amount:'100.00'}]}]
    const model=financialModel(data,'Todos',period)
    expect(model.wageCost).toBe(100);expect(model.expenseCost).toBe(20);expect(model.paid).toBe(110);expect(model.payable).toBe(0);expect(model.expenses).toHaveLength(1)
    expect(model.categories('Pagados').find(item=>item.name==='Transporte')?.amount).toBe(20)
  })
  it('splits legacy labor by event company and preserves net payable and actual partial settlement dates',()=>{
    const fifth={...event,id:'fifth',businessUnit:'5to Elemento' as const}
    const data=emptyFinancialData();data.events=[event,fifth]
    data.legacy.entries=[{id:'legacy',employeeName:'Legacy',periodStart:'2026-09-22',periodEnd:'2026-09-28',laborCost:'100.00',netPay:'90.00',allocations:[{scope:'event',eventId:'fifth',amount:'60.00'},{scope:'warehouse',amount:'40.00'}]}]
    data.legacy.settlements=[{id:'legacy-paid',payrollEntryId:'legacy',paymentDate:'2026-09-25',amount:'45.00'}]
    const fifthModel=financialModel(data,'5to Elemento',period),splModel=financialModel(data,'SPL',period)
    expect(fifthModel).toMatchObject({wageCost:60,paid:27,payable:27})
    expect(splModel).toMatchObject({wageCost:40,paid:18,payable:18})
  })
  it('keeps zero-valued categories and legacy categories but excludes closed old expenses from all-period details',()=>{
    const data=emptyFinancialData();data.quick=[{id:'old',name:'Old paid',category:'Legacy category',amount:'30.00',expenseDate:'2026-09-01',businessUnit:'SPL',notes:'',paymentMethod:null,createdBy:'test',createdAt:''}]
    const model=financialModel(data,'Todos',period)
    expect(model.categories('Pagados')).toHaveLength(8)
    expect(model.categories('Pagados').every(item=>item.amount===0)).toBe(true)
    expect(model.expenseRows('Todos','Todas')).toHaveLength(0)
  })
  it('does not leak next-month cash into the final weekly chart point of a selected month',()=>{
    const data=emptyFinancialData();data.income=[utility({id:'within',receivedDate:'2026-09-30'}),utility({id:'next',receivedDate:'2026-10-01'})]
    const model=financialModel(data,'Todos',dashboardPeriod('2026-09-23','month'))
    expect(model.weekly.at(-1)).toMatchObject({incoming:200,received:200,profit:200})
  })
})
