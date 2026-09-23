import { describe, expect, it, vi } from 'vitest'
import { WebSocketBridge } from '../bridge.js'

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
