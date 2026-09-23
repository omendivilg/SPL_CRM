import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import 'dotenv/config'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stagingDirectory = resolve(root, 'desktop-backend-dist')
const binaryDirectory = resolve(root, 'src-tauri', 'binaries')
const bundlePath = resolve(stagingDirectory, 'spl-backend.cjs')
const outputPath = resolve(binaryDirectory, 'spl-node-x86_64-pc-windows-msvc.exe')
const credentialsFile = process.env.GOOGLE_DESKTOP_CREDENTIALS_FILE
if (!credentialsFile) throw new Error('GOOGLE_DESKTOP_CREDENTIALS_FILE must point to the Desktop app OAuth JSON downloaded from Google Cloud')
const credentials = JSON.parse(await readFile(resolve(root, credentialsFile), 'utf8')).installed
if (!credentials?.client_id?.endsWith('.apps.googleusercontent.com') || !credentials.client_secret) {
  throw new Error('The desktop OAuth JSON must contain installed.client_id and installed.client_secret')
}
if (process.env.GOOGLE_DESKTOP_CLIENT_ID && process.env.GOOGLE_DESKTOP_CLIENT_ID !== credentials.client_id) {
  throw new Error('GOOGLE_DESKTOP_CLIENT_ID does not match the desktop OAuth JSON')
}

await rm(stagingDirectory, { recursive: true, force: true })
await mkdir(stagingDirectory, { recursive: true })
await mkdir(binaryDirectory, { recursive: true })

await build({
  entryPoints: [resolve(root, 'server', 'desktop.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  minify: true,
  banner: { js: "const __import_meta_url = require('url').pathToFileURL(__filename).href;" },
  define: {
    'import.meta.url': '__import_meta_url',
    '__GOOGLE_DESKTOP_CLIENT_ID__': JSON.stringify(credentials.client_id),
    '__GOOGLE_DESKTOP_CLIENT_SECRET__': JSON.stringify(credentials.client_secret),
  },
})

await copyFile(process.execPath, outputPath)
