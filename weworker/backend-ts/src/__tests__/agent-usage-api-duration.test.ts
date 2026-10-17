/**
 * The `usage` log line / SSE event used to print the CLI field
 * `duration_api_ms` verbatim. That field is a *session-cumulative* API duration
 * (the CLI's cost ledger, same lifecycle as total_cost_usd and modelUsage), so
 * `api=` could exceed the per-turn `dur=`. These tests pin the per-turn delta
 * on the real mapping path.
 */
import { describe, expect, it } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { mapSdkMessage, type SSEEvent, type UsageEvent } from '../agent.js'
import { createApiDurationTracker, type ApiDurationTracker } from '../usage-metrics.js'

interface ResultFixture {
  duration_ms?: number
  duration_api_ms?: number
  ttft_ms?: number
  num_turns?: number
  subtype?: string
}

function resultMessage(fixture: ResultFixture = {}): SDKMessage {
  return {
    type: 'result',
    subtype: fixture.subtype ?? 'success',
    is_error: false,
    duration_ms: fixture.duration_ms ?? 12276,
    duration_api_ms: fixture.duration_api_ms ?? 14561,
    ttft_ms: fixture.ttft_ms ?? 1031,
    num_turns: fixture.num_turns ?? 2,
    total_cost_usd: 0.315249,
    result: 'ok',
    session_id: 'fixture-session',
    usage: {
      input_tokens: 1135,
      output_tokens: 371,
      cache_read_input_tokens: 62208,
      cache_creation_input_tokens: 0,
    },
  } as unknown as SDKMessage
}

function mapOne(
  fixture: ResultFixture,
  tracker: ApiDurationTracker = createApiDurationTracker(),
): { tracker: ApiDurationTracker; events: SSEEvent[] } {
  return { tracker, events: [...mapSdkMessage(resultMessage(fixture), false, [], tracker)] }
}

function usageOf(events: SSEEvent[]): UsageEvent {
  const event = events.find((item) => item.type === 'usage') as SSEEvent | undefined
  expect(event?.usage).toBeTruthy()
  return event!.usage!
}

describe('usage api= metric', () => {
  it('reports the per-turn delta instead of the session total', () => {
    const tracker = createApiDurationTracker()
    const first = usageOf(mapOne({ duration_api_ms: 14561, duration_ms: 12276 }, tracker).events)
    const second = usageOf(mapOne({ duration_api_ms: 16990, duration_ms: 3278 }, tracker).events)

    // First sample of the ledger = that turn's own API time.
    expect(first.duration_api_ms).toBe(14561)
    expect(first.duration_api_ms_total).toBe(14561)
    // Second turn: 16990 - 14561, which now fits inside the turn's wall clock.
    expect(second.duration_api_ms).toBe(2429)
    expect(second.duration_api_ms_total).toBe(16990)
    expect(second.duration_api_ms!).toBeLessThanOrEqual(second.duration_ms!)
    expect(tracker.lastCumulativeMs).toBe(16990)
  })

  it('reproduces the reported log sequence without the session total in the per-turn field', () => {
    const tracker = createApiDurationTracker()
    const rows: Array<{ duration_api_ms: number; duration_ms: number }> = [
      { duration_api_ms: 3094, duration_ms: 2230 },
      { duration_api_ms: 2687, duration_ms: 2064 },
      { duration_api_ms: 8277, duration_ms: 10481 },
      { duration_api_ms: 11282, duration_ms: 3808 },
      { duration_api_ms: 14561, duration_ms: 12276 },
      { duration_api_ms: 16990, duration_ms: 3278 },
    ]
    const perTurn = rows.map((row) => usageOf(mapOne(row, tracker).events).duration_api_ms)

    expect(perTurn).toEqual([3094, 2687, 5590, 3005, 3279, 2429])
    // The old code printed 16990ms for the last row while that turn only ran
    // 3278ms; no turn now inherits the whole session total.
    expect(Math.max(...(perTurn as number[]))).toBeLessThan(16990)
  })

  it('treats a smaller cumulative value as a new ledger (new CLI session or /clear)', () => {
    const tracker = createApiDurationTracker()
    usageOf(mapOne({ duration_api_ms: 3094, duration_ms: 2230 }, tracker).events)

    const afterReset = usageOf(mapOne({ duration_api_ms: 2687, duration_ms: 2064 }, tracker).events)

    expect(afterReset.duration_api_ms).toBe(2687)
    expect(afterReset.duration_api_ms_total).toBe(2687)
    expect(tracker.lastCumulativeMs).toBe(2687)
  })

  it('keeps the per-turn field unknown when the CLI reports no duration_api_ms', () => {
    const tracker = createApiDurationTracker()
    const raw = { ...resultMessage({}) } as unknown as Record<string, unknown>
    delete raw.duration_api_ms

    const usage = usageOf([...mapSdkMessage(raw as unknown as SDKMessage, false, [], tracker)])

    expect(usage.duration_api_ms).toBeUndefined()
    expect(usage.duration_api_ms_total).toBeUndefined()
    expect(tracker.lastCumulativeMs).toBeNull()
  })

  it('carries the untouched token and cache metrics alongside the new fields', () => {
    const usage = usageOf(mapOne({}).events)

    expect(usage.total_input_tokens).toBe(1135 + 62208)
    expect(usage.output_tokens).toBe(371)
    expect(usage.cache_hit_rate).toBeCloseTo(62208 / 63343, 5)
    expect(usage.num_turns).toBe(2)
    expect(usage.total_cost_usd).toBe(0.315249)
  })
})
