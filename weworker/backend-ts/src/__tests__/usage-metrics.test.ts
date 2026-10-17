/**
 * P0.5: usage-metrics — token totals + cache-hit rate extraction.
 */
import { describe, it, expect } from 'vitest'
import { computeUsageMetrics, createApiDurationTracker, resolveTurnApiDuration } from '../usage-metrics.js'

describe('P0.5: computeUsageMetrics', () => {
  it('sums fresh input + cache read + cache create into total_input_tokens', () => {
    const m = computeUsageMetrics({
      input_tokens: 1000,
      cache_read_input_tokens: 4000,
      cache_creation_input_tokens: 500,
      output_tokens: 300,
    })
    expect(m.total_input_tokens).toBe(5500)
    expect(m.output_tokens).toBe(300)
  })

  it('computes cache_hit_rate = cache_read / total_input', () => {
    const m = computeUsageMetrics({
      input_tokens: 1000,
      cache_read_input_tokens: 4000,
      cache_creation_input_tokens: 1000,
      output_tokens: 0,
    })
    // 4000 / (1000 + 4000 + 1000) = 4000/6000 = 0.666...
    expect(m.cache_hit_rate).toBeCloseTo(4000 / 6000, 5)
  })

  it('cache_hit_rate is 1.0 when the whole prefix was read from cache', () => {
    const m = computeUsageMetrics({
      input_tokens: 0,
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 0,
      output_tokens: 10,
    })
    expect(m.cache_hit_rate).toBe(1)
  })

  it('cache_hit_rate is 0 when nothing was cached (cold prompt)', () => {
    const m = computeUsageMetrics({
      input_tokens: 5000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 5000,
      output_tokens: 10,
    })
    expect(m.cache_hit_rate).toBe(0)
  })

  it('treats missing/undefined usage as all-zero (no division by zero)', () => {
    const m = computeUsageMetrics(undefined)
    expect(m.total_input_tokens).toBe(0)
    expect(m.cache_hit_rate).toBe(0)
    expect(m.input_tokens).toBe(0)
  })

  it('treats partially-missing fields as zero', () => {
    const m = computeUsageMetrics({ input_tokens: 200, output_tokens: 5 })
    expect(m.cache_read_input_tokens).toBe(0)
    expect(m.cache_creation_input_tokens).toBe(0)
    expect(m.total_input_tokens).toBe(200)
    expect(m.cache_hit_rate).toBe(0)
  })
})

/**
 * The CLI result field `duration_api_ms` is a session-cumulative API duration
 * (same cost-ledger lifecycle as total_cost_usd), so it must be converted to a
 * per-turn delta before it is logged next to the per-turn `dur`.
 */
describe('resolveTurnApiDuration', () => {
  it('takes the first sample of a fresh ledger as this turn', () => {
    expect(resolveTurnApiDuration(3094, null)).toEqual({ turnMs: 3094, cumulativeMs: 3094, baselineReset: false })
  })

  it('subtracts the previous cumulative sample for later turns', () => {
    // Log evidence: 01:24:16 api=14561, 01:30:08 api=16990 → second turn spent 2429ms.
    expect(resolveTurnApiDuration(16990, 14561)).toEqual({ turnMs: 2429, cumulativeMs: 16990, baselineReset: false })
  })

  it('reports a flat zero when a turn made no further API call', () => {
    expect(resolveTurnApiDuration(14561, 14561)).toEqual({ turnMs: 0, cumulativeMs: 14561, baselineReset: false })
  })

  it('detects a ledger reset (new session or /clear) and uses the raw value', () => {
    // Log evidence: cumulative dropped 3094 → 2687 when a new CLI session started.
    expect(resolveTurnApiDuration(2687, 3094)).toEqual({ turnMs: 2687, cumulativeMs: 2687, baselineReset: true })
  })

  it('keeps a zeroed result at zero without inventing a reset', () => {
    // The CLI zeroes duration_api_ms for crash / startup-error results.
    expect(resolveTurnApiDuration(0, null)).toEqual({ turnMs: 0, cumulativeMs: 0, baselineReset: false })
    expect(resolveTurnApiDuration(0, 5000)).toEqual({ turnMs: 0, cumulativeMs: 0, baselineReset: true })
  })

  it('treats missing or non-finite values as unknown and keeps the baseline', () => {
    expect(resolveTurnApiDuration(undefined, 8090)).toEqual({ turnMs: null, cumulativeMs: 8090, baselineReset: false })
    expect(resolveTurnApiDuration(null, null)).toEqual({ turnMs: null, cumulativeMs: null, baselineReset: false })
    expect(resolveTurnApiDuration(Number.NaN, 8090)).toEqual({ turnMs: null, cumulativeMs: 8090, baselineReset: false })
    expect(resolveTurnApiDuration(Number.POSITIVE_INFINITY, 8090)).toEqual({ turnMs: null, cumulativeMs: 8090, baselineReset: false })
  })

  it('clamps a negative cumulative value to zero', () => {
    expect(resolveTurnApiDuration(-5, null)).toEqual({ turnMs: 0, cumulativeMs: 0, baselineReset: false })
  })

  it('walks a whole session the way the per-turn log line does', () => {
    const tracker = createApiDurationTracker()
    const rawPerTurn = [3094, 2687, 8277, 11282, 14561, 16990]
    const perTurn: number[] = []
    for (const raw of rawPerTurn) {
      const sample = resolveTurnApiDuration(raw, tracker.lastCumulativeMs)
      if (sample.cumulativeMs !== null) tracker.lastCumulativeMs = sample.cumulativeMs
      perTurn.push(sample.turnMs ?? -1)
    }
    // The cumulative counter grew to 16990ms while no single turn spent more
    // than the CLI's per-turn wall clock for that turn.
    expect(perTurn).toEqual([3094, 2687, 5590, 3005, 3279, 2429])
    expect(tracker.lastCumulativeMs).toBe(16990)
  })

  it('never reports a per-turn value larger than the cumulative total', () => {
    const tracker = createApiDurationTracker()
    for (const raw of [0, 12, 12, 900, 40, 1000, 1000]) {
      const sample = resolveTurnApiDuration(raw, tracker.lastCumulativeMs)
      if (sample.cumulativeMs !== null) tracker.lastCumulativeMs = sample.cumulativeMs
      expect(sample.turnMs).not.toBeNull()
      expect(sample.turnMs!).toBeLessThanOrEqual(sample.cumulativeMs!)
      expect(sample.turnMs!).toBeGreaterThanOrEqual(0)
    }
  })
})
