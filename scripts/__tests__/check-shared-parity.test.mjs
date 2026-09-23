import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { compareSharedFiles } from '../check-shared-parity.mjs'

test('shared baseline detects omissions and semantic drift while allowing platform newlines', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-parity-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const left = path.join(root, 'public'), right = path.join(root, 'profile')
  fs.mkdirSync(left); fs.mkdirSync(right)
  fs.writeFileSync(path.join(left, 'runtime.js'), 'export const value = 1\n')
  fs.writeFileSync(path.join(right, 'runtime.js'), 'export const value = 1\r\n')
  assert.deepEqual(compareSharedFiles(left, right, ['runtime.js']), [])
  fs.writeFileSync(path.join(right, 'runtime.js'), 'export const value = 2\n')
  assert.deepEqual(compareSharedFiles(left, right, ['runtime.js', 'missing.js']), [
    { file: 'runtime.js', reason: 'different' }, { file: 'missing.js', reason: 'missing' },
  ])
  assert.throws(() => compareSharedFiles(left, right, ['../outside']), /Invalid shared path/)
})
