import {spawn} from 'node:child_process'
import {createHash, randomUUID} from 'node:crypto'
import {createWriteStream} from 'node:fs'
import {appendFile, mkdir, open, readFile, rename, rm, stat, writeFile} from 'node:fs/promises'
import {isAbsolute, join, resolve} from 'node:path'
import {Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {pathToFileURL} from 'node:url'

// Runs only on the Fly machine. Credentials stay in that machine's environment.
export async function remoteBackup() {
  const {spawn} = await import('node:child_process')
  const {createReadStream} = await import('node:fs')
  const {chmod, mkdtemp, stat, rm} = await import('node:fs/promises')
  const {tmpdir} = await import('node:os')
  const {join} = await import('node:path')
  const {createHash} = await import('node:crypto')
  const {Transform} = await import('node:stream')
  const {pipeline} = await import('node:stream/promises')
  let directory
  try {
    process.umask(0o077)
    const url = new URL(process.env.DATABASE_URL)
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('configuration')
    const host = url.hostname.endsWith('.neon.tech') ? url.hostname.replace('-pooler.', '.') : url.hostname
    const env = {...process.env, PGHOST: host, PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGSSLMODE: 'verify-full', PGSSLROOTCERT: 'system', PGCONNECT_TIMEOUT: '15'}
    delete env.DATABASE_URL
    directory = await mkdtemp(join(tmpdir(), 'spl-weekly-'))
    await chmod(directory, 0o700)
    const archive = join(directory, 'backup.dump')
    const command = (name, args) => new Promise((accept, reject) => {
      const child = spawn(name, args, {env, stdio: 'ignore', timeout: 15 * 60_000})
      child.once('error', () => reject(new Error('utility')))
      child.once('close', code => code === 0 ? accept() : reject(new Error('database')))
    })
    await command('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', archive])
    await chmod(archive, 0o600)
    // No database target: decode every entry to /dev/null without restoring data.
    await command('pg_restore', ['--file=/dev/null', '--no-owner', '--no-privileges', archive])
    const hash = createHash('sha256')
    await pipeline(createReadStream(archive), new Transform({transform(chunk, encoding, callback) {
      hash.update(chunk); callback(null, chunk)
    }}), process.stdout)
    process.stderr.write(`SPL_BACKUP_META ${(await stat(archive)).size} ${hash.digest('hex')}\n`)
  } catch {
    process.stderr.write('SPL_BACKUP_FAILED\n')
    process.exitCode = 1
  } finally {
    if (directory) await rm(directory, {recursive: true, force: true})
  }
}

export function remoteCommand() {
  const encoded = Buffer.from(`(${remoteBackup.toString()})()`).toString('base64')
  return `node -e 'eval(Buffer.from("${encoded}","base64").toString())'`
}

export async function runBackup(config, {spawnProcess = spawn, now = () => new Date()} = {}) {
  if (!config || config.app !== 'spl-crm' || (config.healthUrl !== undefined && config.healthUrl !== 'https://spl-crm.fly.dev/health') ||
      typeof config.directory !== 'string' || !isAbsolute(config.directory) ||
      typeof config.flyPath !== 'string' || !isAbsolute(config.flyPath)) {
    throw new Error('Configuración de respaldo inválida.')
  }
  const directory = resolve(config.directory)
  await mkdir(directory, {recursive: true})
  const lockPath = join(directory, '.spl-backup.lock')
  let lock
  try {
    lock = await open(lockPath, 'wx')
  } catch (error) {
    if (error.code !== 'EEXIST') throw new Error('No se pudo preparar el respaldo.')
    const previousText = await readFile(lockPath, 'utf8').catch(() => '')
    const previous = /^\d+$/.test(previousText) ? Number(previousText) : 0
    let alive = true
    if (Number.isSafeInteger(previous) && previous > 0 && previous <= 2147483647) {
      try { process.kill(previous, 0) } catch (error) { if (error.code === 'ESRCH') alive = false }
    } else {
      alive = Date.now() - (await stat(lockPath)).mtimeMs < 2 * 60_000
    }
    if (alive) throw new Error('Ya existe un respaldo en ejecución.')
    await rm(lockPath)
    lock = await open(lockPath, 'wx')
  }
  await lock.writeFile(String(process.pid))
  const stamp = now().toISOString().replaceAll(':', '-')
  const filename = `SPL-${stamp}-${randomUUID().slice(0, 8)}.dump`
  const finalPath = join(directory, filename), partial = `${finalPath}.partial`
  let child, timer
  try {
    // Wake an automatically stopped Fly machine without a database write.
    if (config.healthUrl) {
      const response = await fetch(config.healthUrl, {redirect: 'error', signal: AbortSignal.timeout(60_000)})
      if (!response.ok) throw new Error('Servidor no disponible.')
    }
    child = spawnProcess(config.flyPath, ['ssh', 'console', '--app', config.app,
      '--quiet', '--command', remoteCommand()], {shell: false, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']})
    let stderr = '', size = 0, header = Buffer.alloc(0)
    const hash = createHash('sha256')
    child.stderr.on('data', chunk => { if (stderr.length < 65536) stderr += chunk.toString() })
    const closed = new Promise((accept, reject) => {
      child.once('error', () => reject(new Error('No se pudo ejecutar Fly.')))
      child.once('close', code => code === 0 ? accept() : reject(new Error('Fly no pudo completar el respaldo.')))
    })
    timer = setTimeout(() => child.kill(), 20 * 60_000)
    const stream = pipeline(child.stdout, new Transform({transform(chunk, encoding, callback) {
      if (header.length < 5) header = Buffer.concat([header, chunk]).subarray(0, 5)
      size += chunk.length; hash.update(chunk); callback(null, chunk)
    }}), createWriteStream(partial, {flags: 'wx'}))
    const results = await Promise.allSettled([closed, stream])
    if (results.some(result => result.status === 'rejected')) throw new Error('No se pudo completar el respaldo; comprueba internet y tu sesión de Fly.')
    const metadata = /(?:^|\n)SPL_BACKUP_META (\d+) ([a-f0-9]{64})(?:\r?\n|$)/.exec(stderr)
    const digest = hash.digest('hex')
    if (header.toString() !== 'PGDMP' || !metadata || Number(metadata[1]) !== size || metadata[2] !== digest) {
      throw new Error('El archivo recibido está incompleto o no es un respaldo válido.')
    }
    await rename(partial, finalPath)
    await writeFile(`${finalPath}.sha256`, `${digest}  ${filename}\n`, {flag: 'wx'})
    await appendFile(join(directory, 'respaldo.log'), `${now().toISOString()} OK ${filename} ${size} bytes\n`)
    return {path: finalPath, size, sha256: digest}
  } catch (error) {
    child?.kill()
    await rm(partial, {force: true}).catch(() => {})
    await appendFile(join(directory, 'respaldo.log'), `${now().toISOString()} ERROR Respaldo no completado; revisar conexión y sesión de Fly.\n`).catch(() => {})
    // Never copy remote stderr, connection strings, or arbitrary exception messages to logs.
    throw new Error('Respaldo no completado. Revisa conexión, disponibilidad del servidor y sesión de Fly.')
  } finally {
    clearTimeout(timer)
    await lock.close()
    await rm(lockPath, {force: true})
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = JSON.parse((await readFile(resolve(process.argv[2]), 'utf8')).replace(/^\uFEFF/, ''))
    const result = await runBackup(config)
    console.log(`Respaldo guardado: ${result.path}`)
  } catch {
    console.error('Respaldo no completado. Revisa respaldo.log, internet y la sesión de Fly.')
    process.exitCode = 1
  }
}
