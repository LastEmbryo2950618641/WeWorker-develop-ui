import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createExplorationCloseGuard } from '../exploration-close-guard.js'

test('close guard accepts only main-frame decisions and coalesces repeated close requests', async () => {
  const ipc = new EventEmitter()
  const sent = []
  const frame = {}
  const webContents = { mainFrame: frame, send: (...args) => sent.push(args) }
  const window = { webContents, show() {}, focus() {}, isDestroyed: () => false }
  const event = { sender: webContents, senderFrame: frame }
  const guard = createExplorationCloseGuard(ipc, () => window)
  assert.equal(await guard.request(), true)
  ipc.emit('website-exploration:dirty', { sender: {}, senderFrame: frame }, true)
  assert.equal(guard.isDirty(), false)
  ipc.emit('website-exploration:dirty', event, true)
  const first = guard.request()
  assert.equal(guard.request(), first)
  const id = sent[0][1]
  ipc.emit('website-exploration:leave-result', event, id + 1, true)
  assert.equal(guard.isDirty(), true)
  ipc.emit('website-exploration:leave-result', event, id, false)
  assert.equal(await first, false)
  assert.equal(guard.isDirty(), true)
  const second = guard.request()
  ipc.emit('website-exploration:leave-result', event, sent[1][1], true)
  assert.equal(await second, true)
  assert.equal(guard.isDirty(), false)
})
