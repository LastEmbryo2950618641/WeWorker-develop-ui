import { describe, expect, it, vi } from 'vitest'
import { BridgeStatus } from '../bridge-status.js'

describe('BridgeStatus adapter scaffold events', () => {
  it.each(['adapter_scaffold_generated', 'adapter_installed'])('notifies listeners for %s', (type) => {
    const status = new BridgeStatus()
    const listener = vi.fn()
    const unsubscribe = status.onAdapterScaffoldGenerated(listener)

    ;(status as unknown as { _handleMessage: (message: Record<string, unknown>) => void })._handleMessage({
      type,
      siteKey: 'todo.example.com',
      adapterDir: '/tmp/adapters/todo.example.com',
    })

    expect(listener).toHaveBeenCalledWith({
      siteKey: 'todo.example.com',
      adapterDir: '/tmp/adapters/todo.example.com',
    })

    unsubscribe()
    ;(status as unknown as { _handleMessage: (message: Record<string, unknown>) => void })._handleMessage({
      type,
      siteKey: 'other.example.com',
    })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('BridgeStatus Adapter state events', () => {
  it('notifies listeners with the committed registry revision', () => {
    const status = new BridgeStatus()
    const listener = vi.fn()
    const unsubscribe = status.onAdapterStateChanged(listener)

    ;(status as unknown as { _handleMessage: (message: Record<string, unknown>) => void })._handleMessage({
      type: 'adapter_state_changed',
      profile: 'public',
      previousRevision: 3,
      revision: 4,
      adapters: ['demo.example.com', 7],
    })

    expect(listener).toHaveBeenCalledWith({
      profile: 'public',
      previousRevision: 3,
      revision: 4,
      adapters: ['demo.example.com'],
    })
    unsubscribe()
  })

  it('ignores malformed revisions', () => {
    const status = new BridgeStatus()
    const listener = vi.fn()
    status.onAdapterStateChanged(listener)

    ;(status as unknown as { _handleMessage: (message: Record<string, unknown>) => void })._handleMessage({
      type: 'adapter_state_changed',
      profile: 'public',
      previousRevision: 'bad',
      revision: 4,
      adapters: [],
    })

    expect(listener).not.toHaveBeenCalled()
  })
})
