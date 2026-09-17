import { copyFile, mkdir, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import 'dotenv/config'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stagingDirectory = resolve(root, 'desktop-backend-dist')
const binaryDirectory = resolve(root, 'src-tauri', 'binaries')
const bundlePath = resolve(stagingDirectory, 'spl-backend.cjs')
const outputPath = resolve(binaryDirectory, 'spl-node-x86_64-pc-windows-msvc.exe')

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
    '__GOOGLE_DESKTOP_CLIENT_ID__': JSON.stringify(process.env.GOOGLE_DESKTOP_CLIENT_ID ?? '920421552012-pqgfa6s1cb0d03hd4jevu9grd0ju2qjb.apps.googleusercontent.com'),
  },
})

await copyFile(process.execPath, outputPath)
