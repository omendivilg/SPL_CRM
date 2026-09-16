import { describe, expect, it, vi } from 'vitest'
import { PostgresEventRepository } from './repository.js'
import type { Principal } from './domain.js'

const coordinator: Principal={userId:'coord',role:'coordinator',unit:'5to Elemento'}
describe('PostgresEventRepository query safety',()=>{
  it('uses bound parameters for hostile event identifiers and unit scope',async()=>{const query=vi.fn().mockResolvedValue({rows:[]});const repo=new PostgresEventRepository({query} as never);const payload="' OR 1=1 --";await repo.findById(payload,coordinator);expect(query).toHaveBeenCalledOnce();const [sql,values]=query.mock.calls[0];expect(sql).toContain('id = $1');expect(sql).toContain('business_unit = $2');expect(sql).not.toContain(payload);expect(values).toEqual([payload,'5to Elemento'])})
  it('never interpolates the coordinator unit into list SQL',async()=>{const query=vi.fn().mockResolvedValue({rows:[]});const repo=new PostgresEventRepository({query} as never);await repo.list(coordinator);const [sql,values]=query.mock.calls[0];expect(sql).toContain('business_unit = $1');expect(sql).not.toContain('5to Elemento');expect(values).toEqual(['5to Elemento'])})
})
