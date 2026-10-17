export type ThinkingEffort = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const THINKING_EFFORTS = new Set<ThinkingEffort>(['off', 'low', 'medium', 'high', 'xhigh', 'max'])

/** Unknown model IDs can make Claude Code omit disabled thinking from the wire request. */
export function buildThinkingExtraBody(effort: ThinkingEffort, existing?: string): string {
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(existing || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = { ...parsed }
  } catch { /* The SDK also ignores invalid extra-body JSON. */ }
  // Let the SDK select its supported enabled/adaptive representation when on.
  // The explicit UI choice takes precedence over an inherited thinking override.
  delete body.thinking
  if (effort === 'off') body.thinking = { type: 'disabled' }
  return JSON.stringify(body)
}

export function resolveThinkingEffort(providerId: string | undefined, model: string | undefined, requested: unknown): ThinkingEffort {
  const candidate = THINKING_EFFORTS.has(String(requested) as ThinkingEffort)
    ? String(requested) as ThinkingEffort
    : 'off'
  const modelName = String(model || '')
  const supportsExtendedEffort = providerId === 'anthropic'
    && /(?:claude-(?:opus|sonnet)-4[.-]6|claude-(?:opus|sonnet)-4[.-]7|fable)/i.test(modelName)
  return supportsExtendedEffort || candidate === 'off' || candidate === 'low' || candidate === 'medium' || candidate === 'high'
    ? candidate
    : 'high'
}
