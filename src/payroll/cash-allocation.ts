export type PayrollBusinessUnit = 'SPL' | '5to Elemento'
export type PayrollAllocation = { scope: 'event' | 'warehouse'; eventId?: string | null; amount: string }

function cents(value: string | number): bigint {
  const normalized = typeof value === 'number' ? value.toFixed(2) : value
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new RangeError('El importe debe ser un monto positivo en centavos.')
  const [whole, fractional = ''] = normalized.split('.')
  const result = BigInt(whole) * 100n + BigInt(fractional.padEnd(2, '0'))
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('El importe excede el rango admitido.')
  return result
}

// Returns currency amounts whose integer cents sum exactly to the original payment.
export function allocatePayrollCents(total: string | number, weights: readonly (string | number)[]): number[] {
  const amount = cents(total)
  const weighted = weights.map(cents)
  if (amount === 0n) return weighted.map(() => 0)
  const denominator = weighted.reduce((sum, weight) => sum + weight, 0n)
  if (denominator === 0n) throw new RangeError('El pago necesita una asignación de nómina.')
  const parts = weighted.map((weight, index) => ({ index, value: amount * weight / denominator, remainder: amount * weight % denominator }))
  const residual = amount - parts.reduce((sum, part) => sum + part.value, 0n)
  const ordered = [...parts].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)
  for (let index = 0; index < Number(residual); index++) ordered[index].value += 1n
  return parts.map(part => Number(part.value) / 100)
}

export function payrollAllocationUnit(allocation: PayrollAllocation, eventUnits: ReadonlyMap<string, PayrollBusinessUnit>, batchUnit?: PayrollBusinessUnit): PayrollBusinessUnit {
  return batchUnit ?? (allocation.scope === 'event' ? eventUnits.get(allocation.eventId ?? '') ?? 'SPL' : 'SPL')
}
