import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('desktop security configuration', () => {
  it('bundles only the declared sidecar and keeps data traffic on loopback', async () => {
    const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
    expect(config.bundle.externalBin).toEqual(['binaries/spl-node'])
    expect(config.bundle.targets).toEqual(['nsis'])
    expect(config.app.security.csp).toBeNull()
    expect(config.bundle.windows.nsis.installMode).toBe('currentUser')
  })

  it('does not expose a remote bind address or shell command interpolation', async () => {
    const rust = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
    expect(rust).toContain('Ipv4Addr::LOCALHOST')
    expect(rust).toContain('.sidecar("spl-node")')
    expect(rust).not.toContain('0.0.0.0')
    expect(rust).not.toContain('cmd.exe')
    expect(rust).toContain('SPL_PARENT_PID')
    const desktop = await readFile(new URL('./desktop.ts', import.meta.url), 'utf8')
    expect(desktop).toContain("default-src 'self'")
    expect(desktop).not.toContain("default-src *")
    expect(desktop).toContain('process.kill(parentProcessId, 0)')
  })
})
