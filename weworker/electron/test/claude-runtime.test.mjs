import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { resolveClaudeCodePath } from '../claude-runtime.js'

test('development and packaged modes select the managed Claude Code runtime', () => {
  assert.equal(
    resolveClaudeCodePath({
      platform: 'win32',
      packaged: false,
      resourcesPath: 'C:\\ignored-resources',
      appRoot: 'C:\\workspace\\weworker',
    }),
    path.join('C:\\workspace\\weworker', 'backend-ts', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
  )

  assert.equal(
    resolveClaudeCodePath({
      platform: 'win32',
      packaged: true,
      resourcesPath: 'C:\\Program Files\\WeWorker\\resources',
      appRoot: 'C:\\ignored-workspace',
    }),
    path.join('C:\\Program Files\\WeWorker\\resources', 'claude-code', 'bin', 'claude.exe'),
  )
})

test('macOS uses the upstream installer native destination', () => {
  assert.equal(resolveClaudeCodePath({ packaged: true, resourcesPath: '/weworker-fixtures/resources', appRoot: '/unused', platform: 'darwin', arch: 'arm64' }), path.join('/weworker-fixtures/resources', 'claude-code', 'bin', 'claude.exe'))
})
