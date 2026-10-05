import ExcelJS from 'exceljs'
import {describe,expect,it} from 'vitest'
import {createMonthlyReport,reportMonthSchema} from './report.js'
import {emptyWeekly, saveWeekly} from './weekly.js'
import {randomUUID} from 'node:crypto'

const event={id:'11111111-1111-4111-8111-111111111111',businessUnit:'SPL' as const,clientName:'=HYPERLINK("https://evil.invalid")',clientPhone:null,venue:'Hacienda',eventDate:'2026-09-18',operationalStatus:'Confirmado' as const,operationalNotes:null,financialNotes:null,agreedPrice:'1000.10',payrollBudget:'400.00',extraExpenseBudget:'200.00',version:1,createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z'}
const data={month:'2026-09',generatedAt:new Date('2026-09-15T12:00:00.000Z'),events:[event],expenses:[{id:'expense-1',eventId:event.id,name:'Transporte',category:'Logística',expenseDate:'2026-08-30',amount:'200.05',paidAmount:'50.05',version:1}],payments:[{id:'payment-1',eventId:event.id,transactionDate:'2026-09-02',amount:'500.05',kind:'payment' as const,idempotencyKey:'key',createdAt:'2026-09-02T00:00:00.000Z'}],expenseSettlements:[{id:'settlement-1',expenseId:'expense-1',paymentDate:'2026-09-03',amount:'50.05',idempotencyKey:'key-2',createdAt:'2026-09-03T00:00:00.000Z',paidAmount:'50.05'}],payroll:[{id:'payroll-1',employeeName:'Andrea',periodStart:'2026-09-01',periodEnd:'2026-09-15',baseCost:'400.00',additions:'0.00',deductions:'25.00',laborCost:'400.00',netPay:'375.00',allocationTotal:'400.00',paidAmount:'100.00',outstandingAmount:'275.00',allocations:[{scope:'event' as const,eventId:event.id,amount:'300.00'},{scope:'warehouse' as const,eventId:null,amount:'100.00'}]}],payrollSettlements:[{id:'payroll-settlement-1',payrollEntryId:'payroll-1',paymentDate:'2026-09-04',amount:'100.00',idempotencyKey:'key-3',createdAt:'2026-09-04T00:00:00.000Z',paidAmount:'100.00',outstandingAmount:'275.00'}]}
const load=async(buffer:Buffer)=>{const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength) as ArrayBuffer);return workbook}

describe('monthly Excel report',()=>{
  it('creates five Spanish sheets with typed money, detail rows and reconciled formulas',async()=>{const buffer=await createMonthlyReport(data);expect(buffer.subarray(0,2).toString()).toBe('PK');const workbook=await load(buffer);expect(workbook.worksheets.map(sheet=>sheet.name)).toEqual(['Resumen','Eventos','Detalle de gastos','Nómina','Movimientos']);const summary=workbook.getWorksheet('Resumen')!;expect(summary.getCell('B5').value).toBe(1000.1);expect(summary.getCell('D10').value).toMatchObject({formula:'D5-D7-D8-D9'});const expenses=workbook.getWorksheet('Detalle de gastos')!;expect(expenses.getCell('D5').value).toBe('Transporte');expect(expenses.getCell('J5').value).toBe(150);expect(expenses.getCell('K5').value).toBe('');const payroll=workbook.getWorksheet('Nómina')!;expect(payroll.getCell('A5').value).toBe('Costo');expect(payroll.getCell('A6').value).toBe('Asignación');expect(payroll.getCell('M6').value).toBe(300);const movements=workbook.getWorksheet('Movimientos')!;expect(movements.rowCount).toBe(7);expect(movements.getColumn(3).numFmt).toContain('#,##0.00')})
  it('neutralizes spreadsheet formula payloads and validates the month strictly',async()=>{const workbook=await load(await createMonthlyReport(data));expect(workbook.getWorksheet('Eventos')!.getCell('C5').value).toBe("'=HYPERLINK(\"https://evil.invalid\")");for(const value of ['2026-00','2026-13','26-09',"2026-09' OR 1=1 --",'2026-09-01'])expect(reportMonthSchema.safeParse(value).success).toBe(false)})
  it('places quick expenses in the month they were paid and includes them once in movements',async()=>{
    const weekly=emptyWeekly()
    weekly.quickExpenses.push({id:'quick-1',name:'Gasolina',category:'Transporte',amount:'125.50',expenseDate:'2026-09-28',businessUnit:'SPL',notes:'Viaje a evento',paymentMethod:'card',createdBy:'owner',createdAt:'2026-09-28T10:00:00Z'})
    weekly.quickExpenses.push({id:'quick-2',name:'Comida',category:'Alimentos',amount:'50.00',expenseDate:'2026-10-01',businessUnit:'SPL',notes:'',paymentMethod:null,createdBy:'owner',createdAt:'2026-09-28T10:00:00Z'})
    const workbook=await load(await createMonthlyReport({...data,weekly}))
    const expenses=workbook.getWorksheet('Detalle de gastos')!
    expect(expenses.getCell('D6').value).toBe('Gasolina')
    expect(expenses.getCell('H6').value).toBe(125.5)
    expect(expenses.getCell('K6').value).toBe('Viaje a evento')
    expect(expenses.getCell('L6').value).toBe('Tarjeta')
    expect(expenses.getCell('D7').value).toBe(null)
    const movements=workbook.getWorksheet('Movimientos')!
    expect([...movements.getColumn(2).values].filter(value=>value==='Gasto directo')).toHaveLength(1)
    const summary=workbook.getWorksheet('Resumen')!
    expect(summary.getCell('B11').value).toBe(125.5)
    expect(summary.getColumn(1).values).not.toContain('Presupuesto de nómina')
    expect(summary.getColumn(1).values).not.toContain('Presupuesto de gastos extra')
    expect(workbook.getWorksheet('Resumen')!.getCell('B10').value).toMatchObject({formula:'B5+B13-B7-B8-B9-B11-B12',result:274.55})
  })
  it('shows direct income by expected month and cash movement by received month',async()=>{
    const weekly=emptyWeekly()
    weekly.directIncomes.push({id:'income-1',name:'Renta de equipo',amount:'300.00',expectedDate:'2026-09-30',receivedDate:'2026-10-02',businessUnit:'SPL',version:2,createdBy:'owner',createdAt:'2026-09-01T00:00:00Z',receivedBy:'owner',receivedAt:'2026-10-02T00:00:00Z'})
    weekly.directIncomes.push({id:'income-2',name:'Servicio',amount:'50.00',expectedDate:'2026-10-10',receivedDate:'2026-09-28',businessUnit:'5to Elemento',version:2,createdBy:'owner',createdAt:'2026-09-01T00:00:00Z',receivedBy:'owner',receivedAt:'2026-09-28T00:00:00Z'})
    weekly.directIncomes.push({id:'income-3',name:'Borrada',amount:'999.00',expectedDate:'2026-09-28',receivedDate:'2026-09-28',businessUnit:'SPL',version:2,createdBy:'owner',createdAt:'2026-09-01T00:00:00Z',deletedAt:'2026-09-29T00:00:00Z',deletedBy:'owner'})
    const workbook=await load(await createMonthlyReport({...data,weekly}))
    const summary=workbook.getWorksheet('Resumen')!
    expect(summary.getCell('B13').value).toBe(300)
    expect(summary.getCell('C13').value).toBe(0)
    expect(summary.getCell('C6').value).toBe(50)
    expect(summary.getCell('B10').value).toMatchObject({result:700.05})
    const movements=workbook.getWorksheet('Movimientos')!
    expect([...movements.getColumn(2).values].filter(value=>value==='Cobro de utilidad')).toHaveLength(1)
    expect([...movements.getColumn(6).values]).toContain('income-2')
    expect([...movements.getColumn(6).values]).not.toContain('income-3')
    expect(workbook.getWorksheet('Utilidades')!.getCell('C5').value).toBe('Renta de equipo')
  })
  it('exports utility notes as safe text and leaves legacy or null notes empty',async()=>{
    const weekly=emptyWeekly()
    const income={name:'Servicio',amount:'25.00',expectedDate:'2026-09-28',receivedDate:'2026-09-28',businessUnit:'SPL' as const,version:1,createdBy:'owner',createdAt:'2026-09-28T00:00:00Z'}
    weekly.directIncomes.push(
      {...income,id:'with-notes',notes:'Pago en oficina\nComprobante recibido'},
      {...income,id:'formula-notes',notes:'=HYPERLINK("https://evil.invalid")'},
      {...income,id:'legacy'},
      {...income,id:'empty',notes:null},
    )
    const sheet=(await load(await createMonthlyReport({...data,weekly}))).getWorksheet('Utilidades')!
    expect(sheet.getCell('H4').value).toBe('Notas')
    expect(sheet.getCell('H5').value).toBe('Pago en oficina\nComprobante recibido')
    expect(sheet.getCell('H6').value).toBe("'=HYPERLINK(\"https://evil.invalid\")")
    expect(sheet.getCell('H7').value).toBe('')
    expect(sheet.getCell('H8').value).toBe('')
  })
  it('attributes warehouse payroll expenses only to their owning unit',async()=>{
    const weekly=emptyWeekly(),id=randomUUID()
    saveWeekly(weekly,{id,version:0,idempotencyKey:randomUUID(),businessUnit:'5to Elemento',periodStart:'2026-09-22',periodEnd:'2026-09-28',lines:[],expenses:[{id:randomUUID(),concept:'Equipo',category:'Compra de equipo',amount:'100.00',notes:'',scope:'warehouse'}]},[],new Map(),{userId:'owner',role:'owner',unit:null})
    const workbook=await load(await createMonthlyReport({...data,weekly}))
    const summary=workbook.getWorksheet('Resumen')!
    expect(summary.getCell('B12').value).toBe(0)
    expect(summary.getCell('C12').value).toBe(100)
    expect(summary.getCell('D12').value).toBe(100)
    const extras=workbook.getWorksheet('Gastos de nómina')!
    expect(extras.getCell('B5').value).toBe('5to Elemento')
    expect(extras.getCell('D5').value).toBe('Compra de equipo')
  })
})
