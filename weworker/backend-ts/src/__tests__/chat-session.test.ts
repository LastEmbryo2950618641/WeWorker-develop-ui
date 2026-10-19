import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  ChatSession,
  PromptQueue,
  disposeChatSession,
  findReusableChatSession,
  registerChatSession,
  disposeAllChatSessions,
  canPoolChatSession,
  CHAT_SESSION_MAX_SESSIONS,
} from '../chat-session.js'

afterEach(() => { disposeAllChatSessions('test'); vi.useRealTimers() })

function fakeQuery() {
  let closed = false
  const messages: SDKMessage[] = [{ type: 'result', subtype: 'success' } as SDKMessage]
  return {
    close: vi.fn(() => { closed = true }),
    async *[Symbol.asyncIterator]() {
      if (closed) return
      yield* messages
    },
  }
}

function createSession(workId = 'work-1') {
  const query = fakeQuery()
  const bindings = {
    workIdRef: { current: workId },
    onAskUser: null,
    memory: { userPromptInjections: 0, postToolBatchInjections: 0 },
  }
  return {
    session: new ChatSession({
      workId,
      fingerprint: 'fingerprint-1',
      bindings,
      queue: new PromptQueue(),
      query,
    }),
    query,
  }
}

describe('chat session reuse', () => {
  it('closes failed initialization before accepting any prompt', async () => {
    const query = { ...fakeQuery(), initializationResult: async () => { throw new Error('fixture init failure') } }
    const session = new ChatSession({ workId: null, fingerprint: 'fixture', queue: new PromptQueue(), query,
      bindings: { workIdRef: { current: null }, onAskUser: null, memory: { userPromptInjections: 0, postToolBatchInjections: 0 } },
    })
    await expect(session.ready()).rejects.toThrow('fixture init failure')
    expect(query.close).toHaveBeenCalledTimes(1)
    session.close('again')
    expect(query.close).toHaveBeenCalledTimes(1)
  })

  it('bounds initialization wait and closes a stuck CLI', async () => {
    vi.useFakeTimers()
    const query = { ...fakeQuery(), initializationResult: () => new Promise(() => {}) }
    const session = new ChatSession({ workId: null, fingerprint: 'fixture', queue: new PromptQueue(), query,
      bindings: { workIdRef: { current: null }, onAskUser: null, memory: { userPromptInjections: 0, postToolBatchInjections: 0 } },
    })
    const ready = expect(session.ready()).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(15_000)
    await ready
    expect(query.close).toHaveBeenCalledTimes(1)
  })

  it('declines new pooled queries when every slot is busy', () => {
    for (let i = 0; i < CHAT_SESSION_MAX_SESSIONS; i++) {
      const { session } = createSession(`work-${i}`)
      session.busy = true
      registerChatSession(session)
    }
    expect(canPoolChatSession('next-work')).toBe(false)
    expect(canPoolChatSession()).toBe(false)
  })
  it('keeps a completed session reusable for the next appended user turn', async () => {
    const { session } = createSession()
    registerChatSession(session)
    session.complete([{ id: 'user-1', role: 'user' }])

    const reusable = findReusableChatSession('work-1', 'fingerprint-1', [
      { id: 'user-1', role: 'user' },
      { id: 'assistant-1', role: 'assistant' },
      { id: 'user-2', role: 'user' },
    ])

    expect(reusable).toBe(session)
    disposeChatSession('work-1', 'test_cleanup')
  })

  it('closes a session when its configuration fingerprint changes', () => {
    const { session, query } = createSession()
    registerChatSession(session)
    session.complete([{ id: 'user-1', role: 'user' }])

    expect(findReusableChatSession('work-1', 'changed', [
      { id: 'user-1', role: 'user' },
      { id: 'user-2', role: 'user' },
    ])).toBeUndefined()
    expect(query.close).toHaveBeenCalledTimes(1)
  })
})
