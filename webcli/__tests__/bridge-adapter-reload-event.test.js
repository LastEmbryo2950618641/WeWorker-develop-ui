import { describe, expect, it, vi } from 'vitest'
import { WebSocketBridge } from '../bridge.js'
import { EventEmitter } from 'node:events'

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  return { WebSocketServer: class extends EventEmitter {} }
})

describe('bridge generated-adapter hot reload event', () => {
  it.each(['completed', 'awaiting_approval', 'failed'])('broadcasts only a completed installation (%s)', async status => {
    const bridge = Object.create(WebSocketBridge.prototype)
    bridge._broadcast = vi.fn()
    bridge._generationWorkers = { publish: vi.fn(async () => ({ status, siteKey: 'example.com', result: { digest: 'fixture-digest' } })) }
    const approval = { reviewId: 'fixture-review', acceptChanges: true }
    await bridge._handlePublishGenerationRun({ id: 'request', runId: 'run', approval }, { send: vi.fn() })
    expect(bridge._generationWorkers.publish).toHaveBeenCalledWith('run', approval)
    expect(bridge._broadcast).toHaveBeenCalledTimes(status === 'completed' ? 1 : 0)
    if (status === 'completed') expect(bridge._broadcast).toHaveBeenCalledWith({ type: 'adapter_installed', siteKey: 'example.com', digest: 'fixture-digest' })
  })
})

describe('bridge Adapter state event broadcast', () => {
  it('normalizes installer state changes for connected consumers', () => {
    const bridge = Object.create(WebSocketBridge.prototype)
    bridge._broadcast = vi.fn()
    bridge._handleAdapterStateEvent({
      type: 'adapter_state_changed',
      profile: 'public',
      previousRevision: 3,
      revision: 4,
      adapters: ['demo.example.com'],
    })
    expect(bridge._broadcast).toHaveBeenCalledWith({
      type: 'adapter_state_changed',
      profile: 'public',
      previousRevision: 3,
      revision: 4,
      adapters: ['demo.example.com'],
    })
  })
})

describe('bridge Adapter reconnect snapshot', () => {
  it('acknowledges heartbeats without refreshing Adapters again and syncs a new connection', () => {
    vi.useFakeTimers()
    try {
      const bridge = Object.create(WebSocketBridge.prototype)
      bridge._clients = new Set()
      bridge._profiles = { connections: new Map(), register: (ws, msg) => ws._browserConnection ||= { contextId: 'example', ws, capabilities: msg.capabilities } }
      bridge._extensionWs = null
      bridge._broadcast = vi.fn()
      bridge._handleExtensionMessage = vi.fn()
      bridge._adapterStateWatcher = { snapshot: () => ({ profile: 'public', revision: 7, adapters: [], sync: true }) }
      bridge._startServer()
      const connect = () => {
        const ws = new EventEmitter()
        ws.readyState = 1
        ws.send = vi.fn()
        bridge._wss.emit('connection', ws, { headers: {} })
        return ws
      }
      const hello = ws => ws.emit('message', JSON.stringify({ type: 'extension_hello', capabilities: [] }))
      const count = (ws, type) => ws.send.mock.calls.filter(([value]) => JSON.parse(value).type === type).length
      const first = connect()
      hello(first)
      vi.advanceTimersByTime(600)
      hello(first)
      hello(first)
      expect(count(first, 'extension_hello_ack')).toBe(3)
      expect(count(first, 'adapter_state_changed')).toBe(1)
      const replacement = connect()
      hello(replacement)
      vi.advanceTimersByTime(600)
      expect(count(replacement, 'adapter_state_changed')).toBe(1)
    } finally { vi.useRealTimers() }
  })

  it('sends the current revision without inventing changed Adapter names', () => {
    const bridge = Object.create(WebSocketBridge.prototype)
    bridge._adapterStateWatcher = {
      snapshot: () => ({
        type: 'adapter_state_changed',
        profile: 'public',
        previousRevision: 7,
        revision: 7,
        adapters: [],
        sync: true,
      }),
    }
    const messages = []
    expect(bridge._sendAdapterStateSnapshot({ send: (value) => messages.push(value) })).toBe(true)
    expect(JSON.parse(messages[0])).toEqual({
      type: 'adapter_state_changed',
      profile: 'public',
      previousRevision: 7,
      revision: 7,
      adapters: [],
      sync: true,
    })
  })
})
