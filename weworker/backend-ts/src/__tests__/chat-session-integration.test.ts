import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../config.js'
import type { Message } from '../works-store.js'

const mocks = vi.hoisted(() => ({ query: vi.fn(), directory: '', mcpContexts: [] as unknown[], recalled: '' }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('../config.js', () => ({
  getConfigDirectory: () => mocks.directory,
  getUserDirectory: () => path.join(mocks.directory, 'user-files'),
  getOpenBrowserAllowedOrigins: () => [],
  getUserDirectoryBlacklist: () => [],
  getSiteEnabled: () => false,
}))
vi.mock('../tools.js', () => ({
  buildMcpServer: (context: unknown) => {
    mocks.mcpContexts.push(context)
    return {}
  },
  getMcpToolDefinitionSummary: () => '',
}))
vi.mock('../logger.js', () => ({ createLogger: () => ({ info() {}, error() {}, warn() {}, debug() {} }) }))
vi.mock('../zcf-sync.js', () => ({ composeSystemPromptWithZcf: (prompt: string) => prompt }))
vi.mock('../adapter-parser.js', () => ({ parseAllAdapters: () => new Map() }))
vi.mock('../user-directory-access.js', () => ({
  buildAgentFilesystemSettings: () => ({}),
  createUnifiedToolGuard: () => async () => ({ behavior: 'allow' }),
}))

vi.mock('../context/long-term-context.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../context/long-term-context.js')>(),
  recallLongTermMemory: () => ({ recalled: mocks.recalled }),
}))

import { buildPromptString, HISTORY_REPLAY_HEADER, streamChat } from '../agent.js'
import {
  ChatSession,
  PromptQueue,
  disposeAllChatSessions,
  disposeChatSession,
  listChatSessions,
  registerChatSession,
  sweepIdleChatSessions,
  CHAT_SESSION_IDLE_MS,
  CHAT_SESSION_MAX_SESSIONS,
  CHAT_SESSION_WARM_IDLE_MS,
} from '../chat-session.js'
import { clearDesktopAdapterCatalogCache } from '../adapter-catalog-cache.js'

type Request = { prompt: string | AsyncIterable<{ message: { content: string } }>; options: Record<string, any> }

/** Fake CLI: streaming input answers every pushed message; a string prompt answers once. */
function installFakeCli(behavior: { hold?: Promise<void>; toolCall?: boolean; failTurn?: number; multipleUsage?: boolean } = {}) {
  const sessions: Array<{ request: Request; received: string[]; closed: boolean }> = []
  mocks.query.mockImplementation((request: Request) => {
    const state = { request, received: [] as string[], closed: false }
    sessions.push(state)
    let release: () => void = () => {}
    const closedSignal = new Promise<void>((resolve) => { release = resolve })
    const answer = async function* (index: number) {
      yield { type: 'system', subtype: 'init', session_id: 'fixture-session' }
      if (behavior.toolCall) {
        yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: `tool-${index}`, name: 'Bash', input: { command: 'webcli call example.com.list' } }] } }
        await Promise.race([behavior.hold, closedSignal])
        if (state.closed) return
      }
      const failed = behavior.failTurn === index
      if (behavior.multipleUsage) {
        for (const [input, parent] of [[100, null], [200, null], [9000, 'subagent-tool']] as const) {
          yield { type: 'assistant', parent_tool_use_id: parent, message: { content: [], usage: { input_tokens: input, cache_read_input_tokens: 50 } } }
        }
      }
      yield { type: 'result', subtype: failed ? 'error_during_execution' : 'success', is_error: failed, errors: failed ? ['fixture failure'] : [], result: `reply ${index}`, usage: { input_tokens: 10, output_tokens: 2 } }
    }
    return {
      async *[Symbol.asyncIterator]() {
        if (typeof request.prompt === 'string') {
          state.received.push(request.prompt)
          yield* answer(1)
          return
        }
        let index = 0
        for await (const message of request.prompt) {
          if (state.closed) return
          state.received.push(message.message.content)
          index += 1
          yield* answer(index)
          if (state.closed) return
        }
      },
      close() {
        state.closed = true
        release()
      },
    }
  })
  return sessions
}

function message(id: string, text: string, role: Message['role'] = 'user'): Message {
  return { id, work_id: 'work-a', role, content: [{ type: 'text', text }], created_at: '' }
}

const settings = { active_provider: 'anthropic', api_key: 'test-only', base_url: 'https://api.anthropic.com', model: 'test-model', context_limit: 1_000_000 } as Settings
const baseOptions = { workId: 'work-a', memoryEnabled: false, reuseSession: true }

async function collect(messages: Message[], overrides: Record<string, unknown> = {}, turnSettings = settings, abort?: AbortController) {
  const events = []
  for await (const event of streamChat(messages, turnSettings, abort, { ...baseOptions, ...overrides })) events.push(event)
  return events
}

beforeEach(() => {
  mocks.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weworker-chat-session-test-'))
  const builtinDir = path.join(mocks.directory, 'builtin')
  fs.mkdirSync(builtinDir, { recursive: true })
  fs.writeFileSync(path.join(builtinDir, '.profile.json'), JSON.stringify({ schema_version: 1, profile: 'public', adapters: [], legacy: [] }))
  vi.stubEnv('WEWORKER_BUILD_PROFILE', 'public')
  vi.stubEnv('WEWORKER_BUILTIN_ADAPTERS_DIR', builtinDir)
  vi.stubEnv('WEWORKER_USER_ADAPTERS_DIR', path.join(mocks.directory, 'adapters'))
  vi.stubEnv('WEBCLI_ADAPTERS_DIR', path.join(mocks.directory, 'adapters'))
  vi.stubEnv('WEWORKER_ADAPTER_DATA_DIR', path.join(mocks.directory, 'adapter-data'))
  vi.stubEnv('WEWORKER_CLAUDE_CODE_PATH', process.execPath)
  clearDesktopAdapterCatalogCache()
  mocks.recalled = ''
  mocks.query.mockReset()
  mocks.mcpContexts.length = 0
})

afterEach(() => {
  disposeAllChatSessions('test')
  clearDesktopAdapterCatalogCache()
  vi.unstubAllEnvs()
  fs.rmSync(mocks.directory, { recursive: true, force: true })
})

describe('desktop chat session reuse', () => {
  it('uses the last main-model input for context while retaining aggregate billing usage', async () => {
    installFakeCli({ multipleUsage: true })
    const events = await collect([message('u1', 'fixture question')])
    const usage = events.find(event => event.type === 'usage')?.usage
    expect(usage?.total_input_tokens).toBe(10)
    expect(usage?.context_input_tokens).toBe(250)
    const snapshot = events.filter(event => event.type === 'context_snapshot').at(-1)?.context
    expect(snapshot?.actual_input_tokens).toBe(250)
  })

  it('replays history with a readable header', () => {
    const prompt = buildPromptString([message('u1', '第一问'), message('a1', '第一答', 'assistant'), message('u2', '第二问')])
    expect(prompt.startsWith(`${HISTORY_REPLAY_HEADER}\n`)).toBe(true)
    expect(prompt).toContain('[当前用户消息]\n第二问')
  })

  it('keeps one CLI for consecutive turns and sends only the new message', async () => {
    const sessions = installFakeCli()
    const first = [message('u1', '第一问')]
    await collect(first)
    const second = [...first, message('a1', 'reply 1', 'assistant'), message('u2', '第二问')]
    const events = await collect(second)
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(typeof sessions[0].request.prompt).not.toBe('string')
    expect(sessions[0].received).toEqual(['第一问', '第二问'])
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(listChatSessions()).toEqual([{ workId: 'work-a', busy: false, turns: 2 }])
  })

  it('starts a fresh CLI from stored history when earlier messages changed', async () => {
    const sessions = installFakeCli()
    await collect([message('u1', '第一问')])
    await collect([message('u1-edited', '改过的问题'), message('a1', 'reply 1', 'assistant'), message('u2', '第二问')])
    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(sessions[0].closed).toBe(true)
    expect(sessions[1].received[0]).toContain(HISTORY_REPLAY_HEADER)
    expect(sessions[1].received[0]).toContain('改过的问题')
  })

  it('does not reuse a session after an unseen user message (for example a routed answer)', async () => {
    installFakeCli()
    await collect([message('u1', '第一问')])
    await collect([
      message('u1', '第一问'), message('a1', 'reply 1', 'assistant'),
      message('u-route', '直调查询'), message('a-route', '直调结果', 'assistant'), message('u2', '第二问'),
    ])
    expect(mocks.query).toHaveBeenCalledTimes(2)
  })

  it('starts a fresh CLI when the model configuration changes', async () => {
    const sessions = installFakeCli()
    const first = [message('u1', '第一问')]
    await collect(first)
    await collect([...first, message('a1', 'reply 1', 'assistant'), message('u2', '第二问')], {}, { ...settings, model: 'other-model' })
    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(sessions[0].closed).toBe(true)
    expect(sessions[1].request.options.model).toBe('other-model')
  })

  it('invalidates edited content even when the stored message id stays the same', async () => {
    const sessions = installFakeCli()
    await collect([message('u1', 'original')])
    await collect([message('u1', 'edited'), message('a1', 'reply 1', 'assistant'), message('u2', 'next')])
    expect(sessions).toHaveLength(2)
    expect(sessions[0].closed).toBe(true)
    expect(sessions[1].received[0]).toContain('edited')
  })

  it('tracks canonical history independently of per-send prompt expansion', async () => {
    const sessions = installFakeCli()
    const first = [message('u1', 'original')]
    await collect([message('u1', 'expanded prompt')], { sessionHistory: first })
    const second = [...first, message('a1', 'reply 1', 'assistant'), message('u2', 'next')]
    await collect(second, { sessionHistory: second })
    expect(sessions).toHaveLength(1)
    expect(sessions[0].received).toEqual(['expanded prompt', 'next'])
  })

  it('closes an unfinished turn when the stream consumer stops early', async () => {
    const sessions = installFakeCli({ toolCall: true, hold: new Promise(() => {}) })
    for await (const event of streamChat([message('u1', 'first')], settings, undefined, baseOptions)) {
      if (event.type === 'tool_call_start') break
    }
    expect(sessions[0].closed).toBe(true)
    expect(listChatSessions()).toEqual([])
  })

  it('closes the session after a failed turn', async () => {
    const sessions = installFakeCli({ failTurn: 1 })
    const events = await collect([message('u1', '第一问')])
    expect(events.some((event) => event.type === 'error')).toBe(true)
    expect(sessions[0].closed).toBe(true)
    expect(listChatSessions()).toEqual([])
  })

  it('closes the CLI when the turn is aborted and starts a new one next time', async () => {
    const sessions = installFakeCli({ toolCall: true, hold: new Promise(() => {}) })
    const abort = new AbortController()
    const events = []
    for await (const event of streamChat([message('u1', '第一问')], settings, abort, baseOptions)) {
      events.push(event)
      if (event.type === 'tool_call_start') abort.abort()
    }
    expect(sessions[0].closed).toBe(true)
    expect(listChatSessions()).toEqual([])
    mocks.query.mockClear()
    const next = installFakeCli()
    await collect([message('u1', '第一问'), message('u2', '再试一次')])
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(next[0].received[0]).toContain('再试一次')
    expect(listChatSessions()).toEqual([{ workId: 'work-a', busy: false, turns: 1 }])
  })

  it('runs a concurrent turn of the same work as a one-off query', async () => {
    let releaseFirst: () => void = () => {}
    const sessions = installFakeCli({ toolCall: true, hold: new Promise<void>((resolve) => { releaseFirst = resolve }) })
    const first = [message('u1', '第一问')]
    const running = collect(first)
    await vi.waitFor(() => expect(sessions[0]?.received).toEqual(['第一问']))
    const concurrent = collect([...first, message('u2', '并发问题')])
    await vi.waitFor(() => expect(sessions).toHaveLength(2))
    expect(typeof sessions[1].request.prompt).toBe('string')
    releaseFirst()
    await Promise.all([running, concurrent])
    expect(sessions[0].closed).toBe(false)
    expect(listChatSessions()).toEqual([{ workId: 'work-a', busy: false, turns: 1 }])
  })


  it('keeps one-off behavior for channel and compaction runs', async () => {
    const sessions = installFakeCli()
    await collect([message('u1', '第一问')], { channelAskUserHandler: async () => 'ok' })
    await collect([message('u1', '第一问')], { streaming: false })
    expect(sessions.every((session) => typeof session.request.prompt === 'string')).toBe(true)
    expect(listChatSessions()).toEqual([])
  })
})

describe('chat session pre-start', () => {
  it('reuses the first warm CLI after the SDK adds its version to the parent environment', async () => {
    vi.stubEnv('CLAUDE_AGENT_SDK_VERSION', undefined)
    const sessions = installFakeCli()
    const queryImplementation = mocks.query.getMockImplementation()!
    mocks.query.mockImplementation((request: Request) => {
      vi.stubEnv('CLAUDE_AGENT_SDK_VERSION', 'fixture-sdk-version')
      return queryImplementation(request)
    })
    await collect([], { warmupOnly: true, workId: undefined })
    await collect([message('u1', 'first question')])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].received).toEqual(['first question'])
  })

  it('reuses warmup with dynamic memory without duplicating it in the system prompt', async () => {
    const sessions = installFakeCli()
    await collect([], { warmupOnly: true, memoryEnabled: true })
    mocks.recalled = 'fixture-preference'
    await collect([message('u1', 'first question')], { memoryEnabled: true })
    expect(sessions).toHaveLength(1)
    expect(sessions[0].request.options.systemPrompt).not.toContain('fixture-preference')
    expect(sessions[0].received[0].match(/fixture-preference/g)).toHaveLength(1)
  })

  it('never summarizes long history or sends a prompt during warmup', async () => {
    const sessions = installFakeCli()
    await warmup({}, { ...settings, context_limit: 100 }, [
      message('u0', 'old history '.repeat(1000)), message('a0', 'reply '.repeat(1000), 'assistant'),
    ])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].received).toEqual([])
  })

  async function warmup(overrides: Record<string, unknown> = {}, turnSettings = settings, messages: Message[] = []) {
    for await (const _event of streamChat(messages, turnSettings, undefined, { ...baseOptions, warmupOnly: true, ...overrides })) { /* drain */ }
  }

  it('starts a work session before the first message and uses it for that turn', async () => {
    const sessions = installFakeCli()
    const history = [message('u0', '旧问题'), message('a0', '旧回答', 'assistant')]
    await warmup({}, settings, history)
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(sessions[0].received).toEqual([])
    expect(listChatSessions()).toEqual([{ workId: 'work-a', busy: false, turns: 0 }])
    // A second warm-up is a no-op while the session exists.
    await warmup({}, settings, history)
    expect(mocks.query).toHaveBeenCalledTimes(1)

    await collect([...history, message('u1', '新问题')])
    expect(mocks.query).toHaveBeenCalledTimes(1)
    // The warm CLI has no history yet, so the first turn carries the full replay.
    expect(sessions[0].received[0]).toContain(HISTORY_REPLAY_HEADER)
    expect(sessions[0].received[0]).toContain('新问题')
    expect(listChatSessions()).toEqual([{ workId: 'work-a', busy: false, turns: 1 }])
  })

  it('binds a spare session to the first new work that matches its configuration', async () => {
    const sessions = installFakeCli()
    await warmup({ workId: undefined })
    expect(listChatSessions()).toEqual([])
    const context = mocks.mcpContexts.at(-1) as { workIdRef: { current: string | null } }
    expect(context.workIdRef.current).toBeNull()

    await collect([message('u1', '第一问')])
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(sessions[0].received).toEqual(['第一问'])
    expect(context.workIdRef.current).toBe('work-a')
    expect(listChatSessions()).toEqual([{ workId: 'work-a', busy: false, turns: 1 }])
  })

  it('keeps a spare built for another configuration and starts a separate session', async () => {
    const sessions = installFakeCli()
    await warmup({ workId: undefined }, { ...settings, model: 'other-model' })
    await collect([message('u1', '第一问')])
    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(sessions[0].closed).toBe(false)
    expect(sessions[1].received).toEqual(['第一问'])
    disposeAllChatSessions('test')
    expect(sessions[0].closed).toBe(true)
  })

  it('closes unused warm sessions sooner than idle conversations', async () => {
    const sessions = installFakeCli()
    await warmup()
    await warmup({ workId: undefined })
    sweepIdleChatSessions(Date.now() + CHAT_SESSION_WARM_IDLE_MS + 1)
    expect(listChatSessions()).toEqual([])
    expect(sessions.every((session) => session.closed)).toBe(true)
  })
})

describe('chat session pool', () => {
  function fakeSession(workId: string) {
    const close = vi.fn()
    const session = new ChatSession({
      workId,
      fingerprint: 'fixture',
      bindings: { workIdRef: { current: workId }, onAskUser: null, memory: { userPromptInjections: 0, postToolBatchInjections: 0 } },
      queue: new PromptQueue(),
      query: { async *[Symbol.asyncIterator]() {}, close },
    })
    return { session, close }
  }

  it('accepts only histories that append assistant replies and one new user message', () => {
    const { session } = fakeSession('work-b')
    session.complete([{ id: 'u1', role: 'user' }])
    expect(session.continues([{ id: 'u1', role: 'user' }])).toBe(false)
    expect(session.continues([{ id: 'u1', role: 'user' }, { id: 'a1', role: 'assistant' }, { id: 'u2', role: 'user' }])).toBe(true)
    expect(session.continues([{ id: 'u1', role: 'user' }, { id: 'u2', role: 'user' }, { id: 'u3', role: 'user' }])).toBe(false)
    expect(session.continues([{ id: 'other', role: 'user' }, { id: 'u2', role: 'user' }])).toBe(false)
    expect(session.continues([{ id: 'u1', role: 'user' }, { id: 'a1', role: 'assistant' }])).toBe(false)
  })

  it('evicts the least recently used idle session and sweeps idle ones', () => {
    const created = Array.from({ length: CHAT_SESSION_MAX_SESSIONS + 1 }, (_, index) => fakeSession(`work-${index}`))
    created.forEach(({ session }, index) => {
      session.lastUsedAt = index
      registerChatSession(session)
    })
    expect(created[0].close).toHaveBeenCalledTimes(1)
    expect(listChatSessions()).toHaveLength(CHAT_SESSION_MAX_SESSIONS)
    sweepIdleChatSessions(Date.now() + CHAT_SESSION_IDLE_MS + 1)
    expect(listChatSessions()).toEqual([])
    for (const { close } of created) expect(close).toHaveBeenCalledTimes(1)
  })
})
