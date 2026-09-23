import { describe, expect, it, vi } from 'vitest'
import { createAdapterStateRefreshHandler } from '../adapter-state-refresh.js'

function fixture(overrides = {}) {
  const calls = { clear: 0, refresh: 0, broadcast: [] as any[], errors: [] as any[] }
  const handler = createAdapterStateRefreshHandler({
    clearCache: () => { calls.clear += 1 },
    refreshSkills: async () => { calls.refresh += 1 },
    broadcast: (event) => calls.broadcast.push(event),
    retryDelaysMs: [0, 0],
    logger: (message, error) => calls.errors.push({ message, error }),
    ...overrides,
  })
  return { calls, handler }
}

const event = { profile: 'public', previousRevision: 1, revision: 2, adapters: ['demo.example.com'] }

describe('adapter state refresh handler', () => {
  it('broadcasts only after cache and skills refresh', async () => {
    const { calls, handler } = fixture()
    handler(event)
    await vi.waitFor(() => expect(calls.broadcast).toHaveLength(1))
    expect(calls.clear).toBe(2)
    expect(calls.refresh).toBe(1)
    expect(calls.broadcast[0]).toEqual({ type: 'adapter_state_changed', ...event })
  })

  it('retries transient refresh failures and keeps failure order', async () => {
    let attempts = 0
    const { calls, handler } = fixture({
      refreshSkills: async () => {
        attempts += 1
        if (attempts < 3) throw new Error(`fixture failure ${attempts}`)
      },
    })
    handler(event)
    await vi.waitFor(() => expect(calls.broadcast).toHaveLength(1))
    expect(attempts).toBe(3)
    expect(calls.errors.map((entry) => entry.message)).toEqual([
      'Adapter state refresh attempt 1 failed; retrying in 0ms',
      'Adapter state refresh attempt 2 failed; retrying in 0ms',
    ])
  })

  it('coalesces rapid state changes to the newest revision', async () => {
    const order: number[] = []
    let releaseFirst: (() => void) | undefined
    const first = new Promise<void>((resolve) => { releaseFirst = resolve })
    let started = false
    const { calls, handler } = fixture({
      refreshSkills: async () => {
        if (!started) {
          started = true
          await first
          return
        }
        order.push(calls.refresh)
      },
    })
    handler({ ...event, revision: 2 })
    handler({ ...event, revision: 3 })
    handler({ ...event, revision: 4 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    releaseFirst?.()
    await vi.waitFor(() => expect(calls.broadcast).toHaveLength(2))
    expect(calls.broadcast.map((entry) => entry.revision)).toEqual([2, 4])
    expect(order).toHaveLength(1)
  })
  it('serializes rapid state changes and remains usable after a final failure', async () => {
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    const first = new Promise<void>((resolve) => { releaseFirst = resolve })
    let started = false
    let failures = 0
    const { handler } = fixture({
      refreshSkills: async () => {
        if (!started) {
          started = true
          order.push('first-start')
          await first
          order.push('first-finish')
          return
        }
        failures += 1
        if (failures === 1) throw new Error('final fixture failure')
        order.push('second-finish')
      },
    })
    handler({ ...event, revision: 2 })
    handler({ ...event, revision: 3 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(['first-start'])
    releaseFirst?.()
    await vi.waitFor(() => expect(order).toEqual(['first-start', 'first-finish', 'second-finish']))
  })
})
