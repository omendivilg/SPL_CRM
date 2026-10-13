import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {createHash} from 'node:crypto'
import {mkdtemp, readdir, readFile, rm, writeFile, utimes} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {remoteCommand, runBackup} from './windows-backup.mjs'

function fakeFly(data, {code = 0, size = data.length, digest = createHash('sha256').update(data).digest('hex')} = {}) {
  return (exe, args, options) => {
    assert.equal(options.shell, false)
    assert.equal(options.windowsHide, true)
    assert.equal(args.includes('--quiet'), true)
    assert.equal(args.join(' ').includes('postgresql://'), false)
    const child = new EventEmitter()
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {}
    setImmediate(() => {
      child.stdout.end(data)
      child.stderr.end(`postgresql://private-user:private-password@host/db\nSPL_BACKUP_META ${size} ${digest}\n`)
      child.emit('close', code)
    })
    return child
  }
}

test('publishes only a complete archive with matching remote hash and sanitized log', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spl-backup-test-'))
  try {
    const data = Buffer.from('PGDMP mock binary archive\u0000\u00ff')
    const result = await runBackup({directory, flyPath:resolve('mock'), app:'spl-crm'}, {spawnProcess:fakeFly(data)})
    assert.deepEqual(await readFile(result.path), data)
    assert.equal((await readFile(`${result.path}.sha256`, 'utf8')).startsWith(result.sha256), true)
    assert.equal((await readFile(join(directory, 'respaldo.log'), 'utf8')).includes('private-password'), false)
    assert.equal((await readdir(directory)).some(name => name.endsWith('.partial') || name.endsWith('.lock')), false)
  } finally { await rm(directory, {recursive:true, force:true}) }
})

for (const [name, data, options] of [
  ['truncated archive', Buffer.from('PGDMP truncated'), {size:1000}],
  ['corrupted archive', Buffer.from('PGDMP corrupted'), {digest:'0'.repeat(64)}],
  ['Fly failure', Buffer.from('PGDMP partial'), {code:1}],
  ['progress contaminating stdout', Buffer.from('Connecting...PGDMP'), {}],
]) {
  test(`does not publish ${name}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spl-backup-test-'))
    try {
      await assert.rejects(runBackup({directory, flyPath:resolve('mock'), app:'spl-crm'}, {spawnProcess:fakeFly(data, options)}))
      assert.deepEqual(await readdir(directory), ['respaldo.log'])
      assert.equal((await readFile(join(directory, 'respaldo.log'), 'utf8')).includes('private-password'), false)
    } finally { await rm(directory, {recursive:true, force:true}) }
  })
}

test('remote command contains no connection value and executes full archive decoding', () => {
  const encoded = remoteCommand().match(/Buffer.from\("([A-Za-z0-9+/=]+)"/)[1]
  const source = Buffer.from(encoded, 'base64').toString()
  assert.equal(source.includes('--file=/dev/null'), true)
  assert.equal(source.includes("PGSSLMODE: 'verify-full'"), true)
  assert.equal(source.includes('postgresql://'), false)
})

test('invalid target configuration fails before filesystem, fetch, or spawn', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'spl-backup-test-'))
  try {
    const directory = join(parent, 'must-not-exist')
    const base = {directory, flyPath:resolve('mock'), app:'spl-crm'}
    for (const override of [{app:'other'}, {healthUrl:'https://other.example/health'}, {directory:'relative'}, {flyPath:'relative'}]) {
      await assert.rejects(runBackup({...base, ...override}, {spawnProcess:() => {throw new Error('spawn must not run')}}), /Configuración/)
    }
    assert.deepEqual(await readdir(parent), [])
  } finally { await rm(parent, {recursive:true, force:true}) }
})

for (const contents of ['', 'invalid', '-1', '999999999999999999999999']) {
  test(`recovers old incomplete lock ${JSON.stringify(contents)}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spl-backup-test-'))
    try {
      const lock = join(directory, '.spl-backup.lock')
      await writeFile(lock, contents)
      const old = new Date(Date.now() - 3 * 60_000)
      await utimes(lock, old, old)
      await runBackup({directory, flyPath:resolve('mock'), app:'spl-crm'}, {spawnProcess:fakeFly(Buffer.from('PGDMP complete'))})
      assert.equal((await readdir(directory)).includes('.spl-backup.lock'), false)
    } finally { await rm(directory, {recursive:true, force:true}) }
  })
}

test('preserves a fresh empty lock and prevents overlapping backup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spl-backup-test-'))
  try {
    await writeFile(join(directory, '.spl-backup.lock'), '')
    await assert.rejects(runBackup({directory, flyPath:resolve('mock'), app:'spl-crm'}, {spawnProcess:() => {throw new Error('must not spawn')}}), /ejecución/)
    assert.deepEqual(await readdir(directory), ['.spl-backup.lock'])
  } finally { await rm(directory, {recursive:true, force:true}) }
})
