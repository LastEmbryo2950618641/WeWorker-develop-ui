import { describe, expect, it } from 'vitest'
import { assertSafeMemoryCandidate, redactMemoryText } from '../memory/memory-safety.js'
import type { MemoryUpdateCandidate } from '../memory/memory-types.js'

function candidate(content: string): MemoryUpdateCandidate {
  return {
    action: 'create',
    memory_type: 'other',
    key: 'other',
    content,
    facts: {},
    scope: {},
    confidence: 0.6,
    related_memory_ids: [],
  }
}

describe('memory safety', () => {
  it('allows local file paths in memory content', () => {
    // 本地文件路径不属于敏感信息：允许原样写入长期记忆，不做替换也不拒收。
    expect(() => assertSafeMemoryCandidate(candidate(
      '用户要求记住：C:\\weworker-fixtures\\user-files\\fixture-image.png 是 2026-10-17 识别过的图片。',
    ))).not.toThrow()
    expect(redactMemoryText('C:\\weworker-fixtures\\user-files\\fixture-image.png'))
      .toContain('fixture-image.png')
    expect(redactMemoryText('/home/weworker-fixtures/user-files/fixture-image.png'))
      .toContain('fixture-image.png')
  })

  it('still rejects credentials in memory content', () => {
    expect(() => assertSafeMemoryCandidate(candidate(
      '用户提供的令牌是 ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    ))).toThrow()
  })

  it('still rejects sensitive keys carried in facts', () => {
    const withFacts = { ...candidate('普通内容'), facts: { token: 'placeholder-value' } }
    expect(() => assertSafeMemoryCandidate(withFacts)).toThrow()
  })
})
