import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password.js'

describe('password hashing',()=>{
  it('round trips a valid password without storing plaintext',async()=>{const hash=await hashPassword('Long-Password-2026');expect(hash).not.toContain('Long-Password-2026');expect(await verifyPassword('Long-Password-2026',hash)).toBe(true);expect(await verifyPassword('Long-Password-2027',hash)).toBe(false)})
  it('uses a unique salt and safely rejects corrupted hashes',async()=>{const first=await hashPassword('Same-Password-2026'),second=await hashPassword('Same-Password-2026');expect(first).not.toBe(second);for(const value of ['', 'plaintext', 'scrypt$1$8$1$bad$bad', 'scrypt$16384$8$1$$'])expect(await verifyPassword('Same-Password-2026',value)).toBe(false)})
})
