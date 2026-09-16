import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
const KEY_LENGTH = 64
const COST = 16384
function derive(password:string,salt:Buffer){return new Promise<Buffer>((resolve,reject)=>scryptCallback(password,salt,KEY_LENGTH,{N:COST,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)))}

export async function hashPassword(password:string) {
  const salt=randomBytes(16)
  const derived=await derive(password,salt)
  return `scrypt$${COST}$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export async function verifyPassword(password:string,stored:string) {
  const [algorithm,n,r,p,saltValue,hashValue]=stored.split('$')
  if(algorithm!=='scrypt'||Number(n)!==COST||Number(r)!==8||Number(p)!==1||!saltValue||!hashValue)return false
  try {
    const expected=Buffer.from(hashValue,'base64url')
    if(expected.length!==KEY_LENGTH)return false
    const actual=await derive(password,Buffer.from(saltValue,'base64url'))
    return timingSafeEqual(actual,expected)
  } catch { return false }
}
