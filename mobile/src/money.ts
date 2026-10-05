/** Normalize user input for the API without passing cents through floating point. */
export function normalizeMoney(input:string):string|null{
  const match=/^(\d+)(?:\.(\d{0,2}))?$/.exec(input.trim())
  if(!match)return null
  const integer=match[1].replace(/^0+/,'')||'0'
  if(integer.length>12)return null
  return `${integer}.${(match[2]??'').padEnd(2,'0')}`
}

export function editableMoney(value:string):string{
  const normalized=normalizeMoney(value)
  if(!normalized)return value
  if(normalized==='0.00')return ''
  return normalized.replace(/0+$/,'').replace(/\.$/,'')
}

export function moneyCents(value:string):bigint{
  const normalized=normalizeMoney(value)
  if(!normalized)throw new Error('Escribe un importe válido con máximo dos decimales.')
  return BigInt(normalized.replace('.',''))
}

export function sumMoney(left:string,right:string):string{
  const cents=moneyCents(left)+moneyCents(right)
  const digits=cents.toString().padStart(3,'0')
  return `${digits.slice(0,-2)}.${digits.slice(-2)}`
}
