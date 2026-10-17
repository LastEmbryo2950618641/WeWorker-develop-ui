import { describe, expect, it } from 'vitest'
import { buildThinkingExtraBody, resolveThinkingEffort } from '../thinking-effort.js'

describe('thinking effort compatibility', () => {
  it('sends an explicit disabled parameter while preserving unrelated extra body fields', () => {
    const body = JSON.parse(buildThinkingExtraBody('off', JSON.stringify({ metadata: { test: true }, thinking: { type: 'enabled', budget_tokens: 1024 } })))
    expect(body).toEqual({ metadata: { test: true }, thinking: { type: 'disabled' } })
    expect(JSON.parse(buildThinkingExtraBody('high', JSON.stringify(body)))).toEqual({ metadata: { test: true } })
  })

  it.each(['invalid', 'null', '[]'])('ignores malformed extra-body configuration: %s', input => {
    expect(JSON.parse(buildThinkingExtraBody('off', input))).toEqual({ thinking: { type: 'disabled' } })
  })

  it.each(['anthropic', 'custom', 'deepseek', 'glm', 'builtin'])('defaults %s to off and accepts explicitly disabling thinking', provider => {
    expect(resolveThinkingEffort(provider, 'test-model', undefined)).toBe('off')
    expect(resolveThinkingEffort(provider, 'test-model', 'invalid')).toBe('off')
    expect(resolveThinkingEffort(provider, 'test-model', 'off')).toBe('off')
  })

  it('keeps the portable three levels for unknown and preset providers', () => {
    expect(resolveThinkingEffort('glm', 'glm-5.2', 'xhigh')).toBe('high')
    expect(resolveThinkingEffort('builtin', 'ark-code-latest', 'max')).toBe('high')
    expect(resolveThinkingEffort('custom', 'unknown-model', 'medium')).toBe('medium')
  })

  it('allows extended levels only for recognized Claude models', () => {
    expect(resolveThinkingEffort('anthropic', 'claude-sonnet-4-6', 'max')).toBe('max')
    expect(resolveThinkingEffort('anthropic', 'claude-opus-4.6', 'xhigh')).toBe('xhigh')
    expect(resolveThinkingEffort('anthropic', 'claude-haiku-4-5-20251001', 'max')).toBe('high')
  })
})
