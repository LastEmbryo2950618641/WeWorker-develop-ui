const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')

function runBuilder({ exists = false, failed = false } = {}) {
  const calls = []
  const exits = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../build-decrypt.cjs'), 'utf8'), {
    __dirname: 'C:/weworker-fixtures/repo/weworker/scripts',
    require(name) {
      if (name === 'node:fs') return { existsSync: () => exists }
      if (name === 'node:path') return path.win32
      if (name === 'node:child_process') return { spawnSync(command, args) { calls.push({ command, args }); return { status: failed ? 1 : 0 } } }
      throw new Error(name)
    },
    process: { platform: 'win32', exit: code => exits.push(code) },
    console: { log() {}, error() {} },
  })
  return { calls, exits }
}

test('Windows decrypt build uses uv and its own pinned environment', () => {
  const { calls, exits } = runBuilder()
  assert.deepEqual(exits, [])
  assert.equal(calls[0].command, 'uv')
  assert.equal(calls[0].args[0], 'venv')
  assert.equal(calls[1].command, 'uv')
  assert.ok(calls[1].args.includes('pyinstaller==6.21.0'))
  assert.ok(calls[1].args.includes('pywin32==311'))
  assert.match(calls[2].command, /build\\decrypt-venv\\Scripts\\python.exe$/)
  assert.ok(calls[2].args.includes('scripts/sd_decrypt.py'))
  assert.equal(runBuilder({ exists: true }).calls.length, 2)
})

test('failed environment setup stops before packaging', () => {
  const { calls, exits } = runBuilder({ failed: true })
  assert.equal(calls.length, 1)
  assert.deepEqual(exits, [1])
})
