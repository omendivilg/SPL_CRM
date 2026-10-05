import { describe, expect, it } from 'vitest'
import { allocatePayrollCents, payrollAllocationUnit } from './cash-allocation'

const sumCents = (amounts: number[]) => amounts.reduce((sum, amount) => sum + Math.round(amount * 100), 0)

describe('payroll payment allocation', () => {
  it('preserves all paid cents across uneven shares and ties', () => {
    expect(allocatePayrollCents('99.99', ['33.33', '33.33', '33.34'])).toEqual([33.33, 33.33, 33.33])
    expect(allocatePayrollCents('1.00', ['1.00', '1.00', '1.00'])).toEqual([0.34, 0.33, 0.33])
    expect(sumCents(allocatePayrollCents('99999999.99', ['33333333.33', '33333333.33', '33333333.34']))).toBe(9999999999)
  })
  it('allocates the remaining total at a cutoff instead of creating debt from payment rounding', () => {
    expect(allocatePayrollCents('45.00', ['60.00', '40.00'])).toEqual([27, 18])
    const firstPayment = allocatePayrollCents('0.50', ['1.00', '1.00', '1.00'])
    const secondPayment = allocatePayrollCents('0.50', ['1.00', '1.00', '1.00'])
    expect(sumCents(firstPayment) + sumCents(secondPayment)).toBe(100)
    expect(allocatePayrollCents('0.00', ['1.00', '1.00', '1.00'])).toEqual([0, 0, 0])
  })
  it('uses event ownership for historic allocations and the explicit unit for current batches', () => {
    const events = new Map([['fifth', '5to Elemento' as const]])
    expect(payrollAllocationUnit({ scope: 'event', eventId: 'fifth', amount: '60.00' }, events)).toBe('5to Elemento')
    expect(payrollAllocationUnit({ scope: 'warehouse', amount: '40.00' }, events)).toBe('SPL')
    expect(payrollAllocationUnit({ scope: 'warehouse', amount: '40.00' }, events, '5to Elemento')).toBe('5to Elemento')
  })
})
