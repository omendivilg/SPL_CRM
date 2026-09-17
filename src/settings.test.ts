import {describe,expect,it} from 'vitest'
import {defaultPreferences,parsePreferences} from './settings'

describe('settings preferences',()=>{
  it('loads valid saved preferences',()=>{expect(parsePreferences('{"defaultUnit":"5to Elemento","reportMonth":"previous","compactMode":true}')).toEqual({defaultUnit:'5to Elemento',reportMonth:'previous',compactMode:true})})
  it('falls back safely for malformed and edge-case storage',()=>{expect(parsePreferences(null)).toEqual(defaultPreferences);expect(parsePreferences('{')).toEqual(defaultPreferences)})
  it('ignores prototype, markup and unexpected option payloads',()=>{const value=parsePreferences('{"defaultUnit":"<script>alert(1)</script>","reportMonth":"../../etc/passwd","compactMode":"yes","__proto__":{"admin":true}}');expect(value).toEqual(defaultPreferences);expect((value as unknown as Record<string,unknown>).admin).toBeUndefined()})
})
