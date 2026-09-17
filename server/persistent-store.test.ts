import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PersistentDevelopmentStore } from './persistent-store.js'

describe('persistent desktop store', () => {
  it('preserves a worker and session across application restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spl-store-'))
    const path = join(directory, 'data.json')
    const first = await PersistentDevelopmentStore.open(path)
    const user = await first.findOrCreateGoogleUser('omendivilg@gmail.com', 'Oscar', 'admin', null)
    await first.createSession(user.id, 'hashed-token', new Date('2030-01-01'))
    await first.createWorker({ name: 'Andrea López' })
    const second = await PersistentDevelopmentStore.open(path)
    expect((await second.listWorkers())[0]?.name).toBe('Andrea López')
    expect(await second.findPrincipal('hashed-token', new Date('2029-01-01'))).toMatchObject({ email: 'omendivilg@gmail.com' })
    expect(await readFile(path, 'utf8')).not.toContain('credential')
  })

  it('rejects malformed and oversized local data instead of loading attack payloads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spl-store-'))
    const malformed = join(directory, 'malformed.json')
    await writeFile(malformed, JSON.stringify({ __proto__: { admin: true }, users: '<script>alert(1)</script>' }))
    await expect(PersistentDevelopmentStore.open(malformed)).rejects.toThrow('estructura válida')
    const oversized = join(directory, 'oversized.json')
    await writeFile(oversized, 'x'.repeat(10 * 1024 * 1024 + 1))
    await expect(PersistentDevelopmentStore.open(oversized)).rejects.toThrow('límite permitido')
  })
})
