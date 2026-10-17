/**
 * Per-turn token & prompt-cache metrics, extracted from the SDK result message.
 *
 * Serves the P0.5 baseline needed to evaluate B1 (input-token growth across
 * conversation turns) and the cache-hit rate that tells us whether the SDK's
 * automatic prompt caching is actually landing.
 */

export interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export interface UsageMetrics {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  /** Fresh input + cache writes + cache reads — the full input context fed to the model. */
  total_input_tokens: number
  /** cache_read_input_tokens / total_input_tokens, clamped to [0, 1]. */
  cache_hit_rate: number
}

export function computeUsageMetrics(usage: RawUsage | undefined | null): UsageMetrics {
  const input_tokens = usage?.input_tokens ?? 0
  const output_tokens = usage?.output_tokens ?? 0
  const cache_read_input_tokens = usage?.cache_read_input_tokens ?? 0
  const cache_creation_input_tokens = usage?.cache_creation_input_tokens ?? 0
  const total_input_tokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
  const cache_hit_rate = total_input_tokens > 0 ? cache_read_input_tokens / total_input_tokens : 0
  return {
    input_tokens,
    output_tokens,
    cache_read_input_tokens,
    cache_creation_input_tokens,
    total_input_tokens,
    cache_hit_rate,
  }
}

/**
 * Claude Code CLI 的 `duration_api_ms` 与 `total_cost_usd` 同生命周期：它是
 * 会话级 cost ledger 里累计的 API 耗时（`costLedger.totalAPIDuration()`），
 * 在 streaming-input（常驻会话）模式下**每一轮 result 都携带累计值**，
 * 所以直接打印会出现 `api` 远大于本轮 `dur` 的现象。
 *
 * 因此必须逐轮做差。基线必须按“一次 query() 调用”的生命周期保存：
 * 常驻会话的所有轮共享一个基线，一次性 query 每轮都是新账本。
 */
export interface ApiDurationTracker {
  /** 上一次 result 里的累计 API 耗时；null 表示还没采过样（新账本）。 */
  lastCumulativeMs: number | null
}

export function createApiDurationTracker(): ApiDurationTracker {
  return { lastCumulativeMs: null }
}

export interface TurnApiDuration {
  /** 本轮真实模型调用耗时（累计值相对上一次采样的增量）。 */
  turnMs: number | null
  /** CLI 报出的累计 API 耗时，仅用于诊断。 */
  cumulativeMs: number | null
  /** 本次采样发现累计基线回退（新会话 / /clear / resume 后重新计数）。 */
  baselineReset: boolean
}

/**
 * 纯函数：把 CLI 的累计 `duration_api_ms` 换算成本轮耗时。
 *
 * - 无有效数值（字段缺失 / NaN / Infinity）→ turnMs 为 null，基线保持不变。
 * - 首次采样（基线为 null）→ 累计值就是本轮值（新账本从 0 起算）。
 * - 累计值 >= 基线 → 本轮值 = 累计值 - 基线。
 * - 累计值 < 基线 → 账本被重置，本轮值 = 累计值。
 */
export function resolveTurnApiDuration(
  rawCumulativeMs: number | null | undefined,
  previousCumulativeMs: number | null,
): TurnApiDuration {
  const raw = typeof rawCumulativeMs === 'number' && Number.isFinite(rawCumulativeMs)
    ? Math.max(0, rawCumulativeMs)
    : null
  if (raw === null) {
    return { turnMs: null, cumulativeMs: previousCumulativeMs, baselineReset: false }
  }
  if (previousCumulativeMs === null) {
    return { turnMs: raw, cumulativeMs: raw, baselineReset: false }
  }
  if (raw < previousCumulativeMs) {
    return { turnMs: raw, cumulativeMs: raw, baselineReset: true }
  }
  return { turnMs: raw - previousCumulativeMs, cumulativeMs: raw, baselineReset: false }
}
