import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const inputBarSource = fs.readFileSync(path.resolve(testDir, '../components/chat/InputBar.jsx'), 'utf8')

test('known router bang commands are sent to chat before the shell fallback', () => {
  assert.match(inputBarSource, /ROUTER_BANG_ALIASES = new Set\(routeAliases\)/)
  assert.match(inputBarSource, /tool\?\.name === token/)

  const routerBranch = inputBarSource.indexOf('if (isKnownRouterToolName(command))')
  const shellFallback = inputBarSource.indexOf('onShellCommand?.(command, trimmed)')
  assert.ok(routerBranch >= 0)
  assert.ok(shellFallback > routerBranch)
})
