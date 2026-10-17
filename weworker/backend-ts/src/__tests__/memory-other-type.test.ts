import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { admitMemoryCandidate } from '../memory/memory-admission.js'
import { MEMORY_BLOCK_CLOSE, MEMORY_BLOCK_OPEN, parseAssistantMemoryOutput } from '../memory/memory-extractor.js'
import {
  applyAdmissionToCandidate,
  planCompletedChatMemoryEvents,
  resolveChatMemoryCandidate,
} from '../memory/memory-event-planner.js'
import { processMemoryEvent } from '../memory/memory-lifecycle.js'
import { retrieveMemories } from '../memory/memory-retriever.js'
import { MemoryStore } from '../memory/memory-store.js'
import type { MemoryUpdateCandidate } from '../memory/memory-types.js'

const adapters = [
  { id: 'billing.example.com', name: '费用管理示例', match: ['billing.example.com'] },
]

const stores: MemoryStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

function createStore(): MemoryStore {
  const store = new MemoryStore(new DatabaseSync(':memory:'))
  stores.push(store)
  return store
}

function otherCandidate(overrides: Partial<MemoryUpdateCandidate> = {}): MemoryUpdateCandidate {
  return {
    action: 'create',
    memory_type: 'other',
    key: 'other',
    content: '用户要求长期记住：每周五需要整理当周工作记录。',
    facts: {},
    scope: {},
    confidence: 0.7,
    ...overrides,
  }
}

describe('other memory type — parsing', () => {
  it('parses a model candidate with memory_type other', () => {
    const parsed = parseAssistantMemoryOutput(
      `已记录。${MEMORY_BLOCK_OPEN}{"should_remember":true,"memory_type":"other","content":"用户要求长期记住：每周五需要整理当周工作记录。"}${MEMORY_BLOCK_CLOSE}`,
    )

    expect(parsed.parseError).toBeUndefined()
    expect(parsed.visibleText).toBe('已记录。')
    expect(parsed.decision?.candidate).toMatchObject({
      action: 'create',
      memory_type: 'other',
      key: 'other',
    })
  })

  it('still restricts failure metadata to task_execution', () => {
    const parsed = parseAssistantMemoryOutput(
      `${MEMORY_BLOCK_OPEN}{"should_remember":true,"memory_type":"other","content":"稳定约定","failure_kind":"environmental"}${MEMORY_BLOCK_CLOSE}`,
    )

    expect(parsed.decision).toBeUndefined()
    expect(parsed.parseError).toContain('failure metadata requires task_execution')
  })
})

describe('other memory type — admission', () => {
  it('rejects other memories on a failed turn with turn_failed', () => {
    const result = admitMemoryCandidate({
      candidate: otherCandidate(),
      baseScope: { user: 'local' },
      adapters,
      toolCalls: [],
      turnSucceeded: false,
    })

    expect(result).toMatchObject({ ok: false, reason: 'turn_failed' })
  })

  it('admits other memories as provisional with a 0.6 confidence cap and no execution evidence', () => {
    const result = admitMemoryCandidate({
      candidate: otherCandidate({ confidence: 0.95 }),
      baseScope: { user: 'local' },
      adapters,
      toolCalls: [],
      turnSucceeded: true,
    })

    expect(result).toMatchObject({
      ok: true,
      reason: 'admitted',
      scope: { user: 'local' },
      verification: 'provisional',
      factsPatch: { verification: 'provisional' },
      confidenceCap: 0.6,
    })
    expect(result).not.toHaveProperty('declarative')
  })
})

describe('other memory type — planning', () => {
  it('plans exactly one agent_decision event for an admitted other candidate', () => {
    const plan = planCompletedChatMemoryEvents({
      baseEventId: 'other-turn',
      baseScope: { user: 'local' },
      userMessage: '请记住：每周五整理当周工作记录。',
      adapters,
      toolCalls: [],
      turnSucceeded: true,
      candidate: otherCandidate(),
    })

    expect(plan.admitReason).toBe('admitted')
    expect(plan.events).toHaveLength(1)
    expect(plan.events[0]).toMatchObject({
      eventId: 'other-turn:agent-other',
      trigger: 'agent_decision',
      expectedMemoryType: 'other',
      scope: { user: 'local' },
      factsPatch: { verification: 'provisional' },
      confidenceCap: 0.6,
    })

    const patched = applyAdmissionToCandidate(otherCandidate({ confidence: 0.95 }), plan.events[0])
    expect(patched.facts).toEqual({ verification: 'provisional' })
    expect(patched.confidence).toBe(0.6)
  })

  it('plans no event and reports turn_failed when the turn failed', () => {
    const plan = planCompletedChatMemoryEvents({
      baseEventId: 'other-failed-turn',
      baseScope: { user: 'local' },
      userMessage: '请记住：每周五整理当周工作记录。',
      adapters,
      toolCalls: [],
      turnSucceeded: false,
      candidate: otherCandidate(),
    })

    expect(plan.events).toHaveLength(0)
    expect(plan.admitReason).toBe('turn_failed')
  })

  it('keeps an other candidate that is not an ignore decision', () => {
    expect(resolveChatMemoryCandidate({ candidate: otherCandidate() })).toMatchObject({ source: 'model' })
    expect(resolveChatMemoryCandidate({ candidate: otherCandidate({ action: 'ignore' }) })).toEqual({ source: 'none' })
  })
})

describe('other memory type — persistence and retrieval', () => {
  it('persists an other memory and recalls it without keyword overlap', async () => {
    const store = createStore()
    const result = await processMemoryEvent({
      eventId: 'other-persist-1',
      expectedMemoryType: 'other',
      scope: { user: 'local' },
      store,
      candidate: otherCandidate({ facts: { verification: 'provisional' } }),
    })

    expect(result).toMatchObject({ status: 'saved' })
    expect(store.listActiveAll()).toMatchObject([{ type: 'other' }])

    const recalled = retrieveMemories(store, {
      query: '帮我看看这个申请怎么处理',
      scope: { user: 'local' },
      limit: 5,
    })

    expect(recalled.map((memory) => memory.type)).toContain('other')
    expect(recalled.map((memory) => memory.content)).toContain('用户要求长期记住：每周五需要整理当周工作记录。')
  })

  it('recalls other memories only inside the matching user scope', () => {
    const store = createStore()
    store.create({
      type: 'other',
      key: 'other',
      content: '跨会话需要记住的背景：示例项目使用固定验收流程。',
      scope: { user: 'user-a' },
      sourceEventId: 'other-scope-a',
    })

    expect(retrieveMemories(store, { query: '无关问题', scope: { user: 'user-a' } })
      .map((memory) => memory.type)).toEqual(['other'])
    expect(retrieveMemories(store, { query: '无关问题', scope: { user: 'user-b' } })).toEqual([])
  })

  it('keeps other recall inside the existing 20-record ceiling', () => {
    const store = createStore()
    for (let index = 0; index < 25; index += 1) {
      store.create({
        type: 'other',
        key: `other_${index}`,
        content: `跨会话背景第 ${index} 条。`,
        scope: { user: 'user-a' },
        sourceEventId: `other-limit-${index}`,
      })
    }

    expect(retrieveMemories(store, { query: '无关问题', scope: { user: 'user-a' }, limit: 50 }).length).toBeLessThanOrEqual(20)
  })
})
