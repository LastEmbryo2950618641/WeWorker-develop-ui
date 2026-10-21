'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const weworkerRoot = path.resolve(__dirname, '..')
const venvRoot = path.join(weworkerRoot, 'build', 'decrypt-venv')
const venvPython = process.platform === 'win32'
  ? path.join(venvRoot, 'Scripts', 'python.exe')
  : path.join(venvRoot, 'bin', 'python')

function run(command, args) {
  const result = spawnSync(command, args, { cwd: weworkerRoot, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited with code ${result.status}`)
}

if (process.platform !== 'win32') {
  console.error('[build-decrypt] sd_decrypt is only supported on Windows.')
  process.exit(1)
}

try {
  if (!fs.existsSync(venvPython)) {
    run('uv', ['venv', '--python', '3.12', venvRoot])
  }
  run('uv', [
    'pip', 'install', '--python', venvPython, '--link-mode', 'copy',
    'pyinstaller==6.21.0', 'pywin32==311',
  ])
  run(venvPython, [
    '-m', 'PyInstaller', '--onefile', '--name', 'sd_decrypt',
    '--distpath', 'build/decrypt-dist', '--workpath', 'build/decrypt-work',
    '--specpath', 'build', 'scripts/sd_decrypt.py', '--noconfirm',
  ])
  console.log('[build-decrypt] build/decrypt-dist/sd_decrypt.exe is ready.')
} catch (error) {
  console.error(`[build-decrypt] ERROR: ${error.message}`)
  process.exit(1)
}
