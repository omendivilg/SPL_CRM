import {describe,expect,it} from 'vitest'
import {calculatePayroll} from './payroll.js'

const base={employeeName:'Andrea López',periodStart:'2026-09-01',periodEnd:'2026-09-15',baseCost:'1000.10',additions:'200.20',deductions:'50.05',allocations:[{scope:'event',eventId:'123e4567-e89b-42d3-a456-426614174000',amount:'800.20'},{scope:'warehouse',amount:'400.10'}]}
describe('payroll calculation',()=>{
  it('reconciles labor cost, net pay, and allocations exactly',()=>{expect(calculatePayroll(base).calculation).toEqual({baseCost:'1000.10',additions:'200.20',deductions:'50.05',laborCost:'1200.30',netPay:'1150.25',allocationTotal:'1200.30'})})
  it('supports zero additions and deductions at cent precision',()=>{const result=calculatePayroll({...base,baseCost:'0.01',additions:'0',deductions:'0.00',allocations:[{scope:'warehouse',amount:'0.01'}]});expect(result.calculation.netPay).toBe('0.01')})
  it('rejects negative pay, allocation mismatches, invalid periods, and excessive lists',()=>{for(const value of [{...base,deductions:'9999.00'},{...base,allocations:[{scope:'warehouse',amount:'1.00'}]},{...base,periodEnd:'2026-08-31'},{...base,allocations:Array.from({length:101},()=>({scope:'warehouse',amount:'1.00'}))}])expect(()=>calculatePayroll(value)).toThrow()})
  it('rejects injection strings, prototype fields, malformed money, and cross-scope identifiers',()=>{for(const value of [{...base,employeeName:"' OR 1=1 --",admin:true},{...base,baseCost:'1; DROP TABLE payroll_entries'},{...base,baseCost:'0.001'},{...base,allocations:[{scope:'warehouse',eventId:'123e4567-e89b-42d3-a456-426614174000',amount:'1200.30'}]},{...base,allocations:[{scope:'event',amount:'1200.30'}]}])expect(()=>calculatePayroll(value)).toThrow()})
})
