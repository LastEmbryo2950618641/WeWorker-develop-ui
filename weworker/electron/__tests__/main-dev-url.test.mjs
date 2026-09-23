import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const mainSource = fs.readFileSync(path.resolve(testDir, '../main.js'), 'utf8')

test('development renderer URL can move away from an occupied default port', () => {
  const expression = mainSource.match(/^const devRendererUrl = (.+)$/m)?.[1]
  assert.ok(expression)
  const resolveUrl = (env) => vm.runInNewContext(expression, { process: { env } })
  assert.equal(resolveUrl({}), 'http://localhost:5173')
  assert.equal(resolveUrl({ WEWORKER_DEV_SERVER_URL: 'http://127.0.0.1:5180' }), 'http://127.0.0.1:5180')
  assert.equal(resolveUrl({ WEWORKER_RENDERER_DEV_URL: 'http://localhost:5174', WEWORKER_DEV_SERVER_URL: 'http://127.0.0.1:5180' }), 'http://localhost:5174')
  assert.match(mainSource, /mainWindow\.loadURL\(devRendererUrl\)/)
  assert.doesNotMatch(mainSource, /mainWindow\.loadURL\('http:\/\/localhost:5173'\)/)
})
