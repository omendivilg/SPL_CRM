import ExcelJS from 'exceljs'
import {Decimal} from 'decimal.js'
import {z} from 'zod'
import type {EventRecord} from './domain.js'
import type {ExpenseRecord,PaymentRecord,SettlementRecord} from './repository.js'
import { expenseProjection, type WeeklyState } from './weekly.js'
import type {PayrollRecord,PayrollSettlement} from './payroll.js'

export const reportMonthSchema=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/,'Mes inválido')
export type MonthlyReportData={month:string;generatedAt:Date;events:EventRecord[];expenses:ExpenseRecord[];payments:PaymentRecord[];expenseSettlements:SettlementRecord[];payroll:PayrollRecord[];payrollSettlements:PayrollSettlement[];weekly?:WeeklyState}
const money=(value:string|null|undefined)=>new Decimal(value??0).toNumber()
const safeText=(value:string|null|undefined)=>{const text=value??'';return /^[=+\-@]/.test(text)?`'${text}`:text}
const currency='"$"#,##0.00;[Red]-"$"#,##0.00'
const dark='141922',orange='EA580C',pale='F3F4F6'

function configure(sheet:ExcelJS.Worksheet,title:string,subtitle:string,columns:Array<{header:string;key:string;width:number}>) {
  sheet.views=[{state:'frozen',ySplit:4}]
  sheet.properties.defaultRowHeight=18
  sheet.mergeCells(1,1,1,columns.length)
  sheet.getCell('A1').value=title
  sheet.getCell('A1').font={name:'Aptos Display',size:18,bold:true,color:{argb:dark}}
  sheet.mergeCells(2,1,2,columns.length)
  sheet.getCell('A2').value=subtitle
  sheet.getCell('A2').font={name:'Aptos',size:10,italic:true,color:{argb:'475569'}}
  sheet.getRow(4).values=columns.map(column=>column.header)
  columns.forEach((column,index)=>{const target=sheet.getColumn(index+1);target.key=column.key;target.width=column.width})
  const header=sheet.getRow(4)
  header.height=28
  for(let column=1;column<=columns.length;column++){const cell=header.getCell(column);cell.font={name:'Aptos',size:10,bold:true,color:{argb:'FFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:dark}};cell.alignment={vertical:'middle',horizontal:'center',wrapText:true}}
  sheet.autoFilter={from:{row:4,column:1},to:{row:4,column:columns.length}}
}

function finish(sheet:ExcelJS.Worksheet,start=5){
  for(let row=start;row<=sheet.rowCount;row++){
    const target=sheet.getRow(row)
    for(let column=1;column<=sheet.columnCount;column++){const cell=target.getCell(column);cell.font={name:'Aptos',size:10,color:{argb:'1F2937'}};cell.alignment={vertical:'middle',wrapText:true};if(row%2===0)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:pale}}}
  }
  sheet.eachRow(row=>row.eachCell(cell=>{cell.border={bottom:{style:'thin',color:{argb:'D9D9D9'}}}}))
}

export async function createMonthlyReport(data:MonthlyReportData){
  const month=reportMonthSchema.parse(data.month)
  const workbook=new ExcelJS.Workbook()
  workbook.creator='SPL';workbook.created=data.generatedAt;workbook.modified=data.generatedAt
  const period=`Periodo ${month} | Alcance: SPL y 5to Elemento | Eventos por fecha del evento; movimientos por fecha de transacción | Generado ${data.generatedAt.toISOString()}`
  const selectedEvents=data.events.filter(event=>event.eventDate.startsWith(month))
  const ids=new Set(selectedEvents.map(event=>event.id))
  const selectedExpenses=data.expenses.filter(expense=>ids.has(expense.eventId))
  const selectedPayroll=data.payroll.filter(entry=>entry.periodEnd.startsWith(month)||entry.allocations.some(item=>item.eventId&&ids.has(item.eventId)))
  const eventById=new Map(data.events.map(event=>[event.id,event]))
  const expenseById=new Map(data.expenses.map(expense=>[expense.id,expense]))
  const payrollById=new Map(data.payroll.map(entry=>[entry.id,entry]))
  const monthlyPayments=data.payments.filter(item=>item.transactionDate.startsWith(month))
  const monthlyExpenseSettlements=data.expenseSettlements.filter(item=>item.paymentDate.startsWith(month)&&expenseById.has(item.expenseId))
  const monthlyPayrollSettlements=data.payrollSettlements.filter(item=>item.paymentDate.startsWith(month))

  const summary=workbook.addWorksheet('Resumen',{views:[{showGridLines:false}]})
  configure(summary,'Resumen mensual',period,[{header:'Concepto',key:'concept',width:34},{header:'SPL',key:'spl',width:18},{header:'5to Elemento',key:'fifth',width:18},{header:'Consolidado',key:'total',width:18}])
  const units=['SPL','5to Elemento'] as const
  const metrics=[
    ['Precio acordado',(unit:string)=>selectedEvents.filter(e=>e.businessUnit===unit).reduce((sum,e)=>sum.plus(e.agreedPrice??0),new Decimal(0))],
    ['Cobros netos del mes',(unit:string)=>monthlyPayments.filter(p=>eventById.get(p.eventId)?.businessUnit===unit).reduce((sum,p)=>sum.plus(p.kind==='refund'?new Decimal(p.amount).negated():p.amount),new Decimal(0))],
    ['Gastos de eventos',(unit:string)=>selectedExpenses.filter(e=>eventById.get(e.eventId)?.businessUnit===unit).reduce((sum,e)=>sum.plus(e.amount),new Decimal(0))],
    ['Costo laboral asignado',(unit:string)=>selectedPayroll.flatMap(p=>p.allocations).filter(a=>a.eventId&&eventById.get(a.eventId)?.businessUnit===unit).reduce((sum,a)=>sum.plus(a.amount),new Decimal(0))],
    ['Costo compartido de almacén',(_unit:string)=>selectedPayroll.flatMap(p=>p.allocations).filter(a=>a.scope==='warehouse').reduce((sum,a)=>sum.plus(a.amount),new Decimal(0)).div(2)],
  ] as const
  metrics.forEach(([label,calc])=>{const left=calc(units[0]),right=calc(units[1]);summary.addRow({concept:label,spl:left.toNumber(),fifth:right.toNumber(),total:left.plus(right).toNumber()})})
  summary.addRow({concept:'Contribución directa',spl:{formula:'B5-B7-B8'},fifth:{formula:'C5-C7-C8'},total:{formula:'D5-D7-D8'}})
  summary.addRow({concept:'Presupuesto de nómina',spl:selectedEvents.filter(e=>e.businessUnit==='SPL').reduce((s,e)=>s.plus(e.payrollBudget),new Decimal(0)).toNumber(),fifth:selectedEvents.filter(e=>e.businessUnit==='5to Elemento').reduce((s,e)=>s.plus(e.payrollBudget),new Decimal(0)).toNumber(),total:{formula:'B11+C11'}})
  summary.addRow({concept:'Presupuesto de gastos extra',spl:selectedEvents.filter(e=>e.businessUnit==='SPL').reduce((s,e)=>s.plus(e.extraExpenseBudget),new Decimal(0)).toNumber(),fifth:selectedEvents.filter(e=>e.businessUnit==='5to Elemento').reduce((s,e)=>s.plus(e.extraExpenseBudget),new Decimal(0)).toNumber(),total:{formula:'B12+C12'}})
  summary.getColumn(2).numFmt=currency;summary.getColumn(3).numFmt=currency;summary.getColumn(4).numFmt=currency
  for(let column=1;column<=4;column++)summary.getRow(10).getCell(column).font={name:'Aptos',size:10,bold:true,color:{argb:orange}}
  finish(summary)

  const events=workbook.addWorksheet('Eventos',{views:[{showGridLines:false}]})
  configure(events,'Eventos',period,[{header:'ID del evento',key:'id',width:38},{header:'Unidad',key:'unit',width:16},{header:'Cliente',key:'client',width:24},{header:'Lugar',key:'venue',width:26},{header:'Fecha',key:'date',width:13},{header:'Precio',key:'price',width:16},{header:'Cobros',key:'receipts',width:16},{header:'Saldo pendiente',key:'balance',width:17},{header:'Nómina',key:'payroll',width:16},{header:'Gastos extra',key:'expenses',width:16},{header:'Contribución directa',key:'contribution',width:18}])
  selectedEvents.forEach(event=>{const receipts=data.payments.filter(p=>p.eventId===event.id).reduce((s,p)=>s.plus(p.kind==='refund'?new Decimal(p.amount).negated():p.amount),new Decimal(0));const expensesTotal=selectedExpenses.filter(e=>e.eventId===event.id).reduce((s,e)=>s.plus(e.amount),new Decimal(0));const payrollTotal=selectedPayroll.flatMap(p=>p.allocations).filter(a=>a.eventId===event.id).reduce((s,a)=>s.plus(a.amount),new Decimal(0));const price=new Decimal(event.agreedPrice??0);events.addRow({id:event.id,unit:event.businessUnit,client:safeText(event.clientName),venue:safeText(event.venue),date:new Date(`${event.eventDate}T00:00:00Z`),price:price.toNumber(),receipts:receipts.toNumber(),balance:price.minus(receipts).toNumber(),payroll:payrollTotal.toNumber(),expenses:expensesTotal.toNumber(),contribution:price.minus(payrollTotal).minus(expensesTotal).toNumber()})})
  events.getColumn(5).numFmt='yyyy-mm-dd';for(let column=6;column<=11;column++)events.getColumn(column).numFmt=currency;finish(events)

  const expenses=workbook.addWorksheet('Detalle de gastos',{views:[{showGridLines:false}]})
  configure(expenses,'Detalle de gastos',`${period} | Incluye cada gasto de los eventos seleccionados aunque su fecha contable sea distinta.`,[{header:'ID del gasto',key:'id',width:38},{header:'Evento',key:'event',width:38},{header:'Unidad',key:'unit',width:16},{header:'Nombre',key:'name',width:26},{header:'Categoría',key:'category',width:18},{header:'Alcance',key:'scope',width:16},{header:'Fecha',key:'date',width:13},{header:'Monto',key:'amount',width:16},{header:'Pagado',key:'paid',width:16},{header:'Pendiente',key:'outstanding',width:16},{header:'Explicación',key:'explanation',width:34}])
  selectedExpenses.forEach(expense=>expenses.addRow({id:expense.id,event:expense.eventId,unit:eventById.get(expense.eventId)?.businessUnit??'',name:safeText(expense.name),category:safeText(expense.category),scope:'Evento',date:new Date(`${expense.expenseDate}T00:00:00Z`),amount:money(expense.amount),paid:money(expense.paidAmount),outstanding:new Decimal(expense.amount).minus(expense.paidAmount).toNumber(),explanation:safeText(expense.notes)}))
  expenses.getColumn(7).numFmt='yyyy-mm-dd';for(let column=8;column<=10;column++)expenses.getColumn(column).numFmt=currency;finish(expenses)

  const payroll=workbook.addWorksheet('Nómina',{views:[{showGridLines:false}]})
  configure(payroll,'Nómina',`${period} | Los costos y las asignaciones se muestran en secciones separadas para evitar doble conteo.`,[{header:'Tipo de fila',key:'type',width:18},{header:'ID de nómina',key:'id',width:38},{header:'Empleado o destino',key:'name',width:26},{header:'Inicio',key:'start',width:13},{header:'Fin',key:'end',width:13},{header:'Costo base',key:'base',width:15},{header:'Adiciones',key:'additions',width:15},{header:'Deducciones',key:'deductions',width:15},{header:'Costo laboral',key:'labor',width:16},{header:'Pago neto',key:'net',width:16},{header:'Pagado',key:'paid',width:15},{header:'Pendiente',key:'outstanding',width:15},{header:'Asignación',key:'allocation',width:16}])
  selectedPayroll.forEach(entry=>{payroll.addRow({type:'Costo',id:entry.id,name:safeText(entry.employeeName),start:new Date(`${entry.periodStart}T00:00:00Z`),end:new Date(`${entry.periodEnd}T00:00:00Z`),base:money(entry.baseCost),additions:money(entry.additions),deductions:money(entry.deductions),labor:money(entry.laborCost),net:money(entry.netPay),paid:money(entry.paidAmount),outstanding:money(entry.outstandingAmount),allocation:null});entry.allocations.forEach(item=>payroll.addRow({type:'Asignación',id:entry.id,name:item.scope==='warehouse'?'Almacén':eventById.get(item.eventId??'')?.clientName??item.eventId,start:null,end:null,base:null,additions:null,deductions:null,labor:null,net:null,paid:null,outstanding:null,allocation:money(item.amount)}))})
  payroll.getColumn(4).numFmt='yyyy-mm-dd';payroll.getColumn(5).numFmt='yyyy-mm-dd';for(let column=6;column<=13;column++)payroll.getColumn(column).numFmt=currency;finish(payroll)

  const movements=workbook.addWorksheet('Movimientos',{views:[{showGridLines:false}]})
  configure(movements,'Movimientos',period,[{header:'Fecha',key:'date',width:13},{header:'Tipo',key:'type',width:22},{header:'Entrada',key:'in',width:16},{header:'Salida',key:'out',width:16},{header:'Unidad',key:'unit',width:16},{header:'ID relacionado',key:'related',width:38},{header:'Descripción',key:'description',width:34}])
  monthlyPayments.forEach(item=>movements.addRow({date:new Date(`${item.transactionDate}T00:00:00Z`),type:item.kind==='payment'?'Cobro de cliente':'Reembolso a cliente',in:item.kind==='payment'?money(item.amount):null,out:item.kind==='refund'?money(item.amount):null,unit:eventById.get(item.eventId)?.businessUnit??'',related:item.eventId,description:safeText(eventById.get(item.eventId)?.clientName)}))
  monthlyExpenseSettlements.forEach(item=>{const expense=expenseById.get(item.expenseId),event=expense&&eventById.get(expense.eventId);movements.addRow({date:new Date(`${item.paymentDate}T00:00:00Z`),type:'Pago de gasto',in:null,out:money(item.amount),unit:event?.businessUnit??'',related:item.expenseId,description:safeText(expense?.name)})})
  monthlyPayrollSettlements.forEach(item=>movements.addRow({date:new Date(`${item.paymentDate}T00:00:00Z`),type:'Pago de nómina',in:null,out:money(item.amount),unit:'Compartido',related:item.payrollEntryId,description:safeText(payrollById.get(item.payrollEntryId)?.employeeName)}))
  movements.getColumn(1).numFmt='yyyy-mm-dd';movements.getColumn(3).numFmt=currency;movements.getColumn(4).numFmt=currency;finish(movements)

  if (data.weekly) {
    const selected = data.weekly.batches.filter(b => b.periodEnd.startsWith(month))
    const batches = workbook.addWorksheet('Nóminas semanales')
    configure(batches,'Nóminas semanales',period,[{header:'ID',key:'id',width:38},{header:'Inicio',key:'start',width:14},{header:'Fin',key:'end',width:14},{header:'Estado',key:'status',width:16},{header:'Trabajadores',key:'workers',width:15},{header:'Sueldos netos',key:'wages',width:18},{header:'Otros gastos',key:'extras',width:18},{header:'Total',key:'total',width:18},{header:'Fecha de pago',key:'paid',width:16}])
    for (const batch of selected) batches.addRow({id:batch.id,start:batch.periodStart,end:batch.periodEnd,status:batch.status==='paid'?'Pagada':'No pagada',workers:batch.lines.length,wages:money(batch.wagesTotal),extras:money(batch.expensesTotal),total:money(batch.total),paid:batch.payments.findLast(p=>!p.reversedAt)?.paymentDate??''})
    for (const column of [6,7,8]) batches.getColumn(column).numFmt=currency
    finish(batches)
    const extraSheet = workbook.addWorksheet('Gastos de nómina')
    configure(extraSheet,'Gastos de nómina',period,[{header:'Nómina',key:'batch',width:38},{header:'Concepto',key:'name',width:28},{header:'Destino',key:'destination',width:28},{header:'Importe',key:'amount',width:18},{header:'Notas',key:'notes',width:40}])
    for (const batch of selected) for (const extra of batch.expenses) extraSheet.addRow({batch:batch.id,name:safeText(extra.concept),destination:extra.scope==='warehouse'?'Almacén':safeText(eventById.get(extra.eventId??'')?.clientName),amount:money(extra.amount),notes:safeText(extra.notes)})
    extraSheet.getColumn(4).numFmt=currency;finish(extraSheet)
    const warehouseExtras = expenseProjection(data.weekly).filter(e=>e.scope==='warehouse'&&e.expenseDate.startsWith(month))
    const warehouseTotal = warehouseExtras.reduce((sum,e)=>sum.plus(e.amount),new Decimal(0))
    summary.addRow({concept:'Otros gastos de nómina - almacén',spl:warehouseTotal.div(2).toNumber(),fifth:warehouseTotal.div(2).toNumber(),total:warehouseTotal.toNumber()})
    for (const batch of data.weekly.batches) for (const payment of batch.payments) {
      if(payment.paymentDate.startsWith(month)) movements.addRow({date:new Date(`${payment.paymentDate}T00:00:00Z`),type:'Pago completo de nómina',in:null,out:money(payment.amount),unit:'Compartido',related:batch.id,description:`Semana ${batch.periodStart} al ${batch.periodEnd}`})
      if(payment.reversedAt?.startsWith(month)) movements.addRow({date:new Date(payment.reversedAt),type:'Reversión de registro',in:money(payment.amount),out:null,unit:'Compartido',related:batch.id,description:safeText(payment.reversalReason)})
    }
    finish(movements)
  }
  const buffer=await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
