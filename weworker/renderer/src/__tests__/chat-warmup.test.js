import { it } from 'node:test'
import assert from 'node:assert/strict'
import { requestChatWarmup } from '../api/backend.js'

it('prewarms welcome and work routes once per throttle window and retries failures', async (t) => {
  const calls = []
  const previousWindow = globalThis.window
  globalThis.window = { electronAPI: {} }
  let now = 100_000
  t.mock.method(Date, 'now', () => now)
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url)
    return { ok: !url.includes('failed-work') }
  })
  try {
    await Promise.all([requestChatWarmup(), requestChatWarmup()])
    assert.equal(calls.length, 1)
    assert.ok(calls[0].endsWith('/chat/warmup'))
    await requestChatWarmup('fixture-work')
    await requestChatWarmup('fixture-work')
    assert.equal(calls.length, 2)
    now += 31_000
    await requestChatWarmup('fixture-work')
    assert.equal(calls.length, 3)
    await requestChatWarmup('failed-work')
    await requestChatWarmup('failed-work')
    assert.equal(calls.length, 5)
  } finally {
    globalThis.window = previousWindow
  }
})
