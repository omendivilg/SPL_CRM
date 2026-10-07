import 'dotenv/config'
import { createHash } from 'node:crypto'
import { readFile, copyFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { Pool } from 'pg'
import { importLocalSnapshot, parseLocalImportState } from '../server/local-import.js'

const sourceArg = process.argv[2], databaseUrl = process.env.DATABASE_URL
if (!sourceArg) throw new Error('Usage: npm run db:import-local -- C:\\path\\to\\spl-data.json')
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const source = resolve(sourceArg), content = await readFile(source)
const state = parseLocalImportState(JSON.parse(content.toString('utf8')))
const hash = createHash('sha256').update(content).digest('hex')
await copyFile(source, `${source}.before-cloud-import.bak`)
const pool = new Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined, max: 1 })
try {
  const client = await pool.connect()
  try {
    const result = await importLocalSnapshot(client, state, hash, basename(source))
    if (result.alreadyImported) console.log('This exact snapshot was already imported.')
    else console.log(JSON.stringify({ source, hash, counts: result.counts }, null, 2))
  } finally { client.release() }
} finally { await pool.end() }
