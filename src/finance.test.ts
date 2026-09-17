import {describe,expect,it} from 'vitest'
import {calculateFinanceSummary} from './finance'

describe('finance summary',()=>{
  it('reconciles receipts, refunds, costs and liabilities to the cent',()=>{expect(calculateFinanceSummary([{price:1000.1,payrollActual:200.05,payrollBudget:300,expenseBudget:100,payments:[{amount:500.05},{amount:20,kind:'refund'}],expenses:[{amount:100.1,paid:40.05}]}])).toEqual({agreed:'1000.10',received:'480.05',expenses:'100.10',payroll:'200.05',contribution:'699.95',receivable:'520.05',payable:'60.05'})})
  it('handles pending prices, overpayments and empty data without negative balances',()=>{expect(calculateFinanceSummary([{price:null,payrollActual:0,payrollBudget:0,expenseBudget:0,payments:[{amount:10}],expenses:[]}]).receivable).toBe('0.00');expect(calculateFinanceSummary([])).toEqual({agreed:'0.00',received:'0.00',expenses:'0.00',payroll:'0.00',contribution:'0.00',receivable:'0.00',payable:'0.00'})})
  it('treats hostile text as irrelevant to numeric calculation',()=>{const hostile={price:100,payrollActual:0,payrollBudget:0,expenseBudget:0,payments:[],expenses:[{amount:10,paid:0,name:'<img onerror=alert(1)>',category:"' OR 1=1 --"}]};expect(calculateFinanceSummary([hostile])).toMatchObject({expenses:'10.00',contribution:'90.00'})})
})
