import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settings: { api_key: 'placeholder-model-key' },
  runChannelChat: vi.fn(),
  getChannelPermissionMode: vi.fn(() => 'qa_only'),
  getLatestChannelNotifyTarget: vi.fn(() => null),
  saveChannelNotifyTarget: vi.fn(),
  getOrCreateChannelWork: vi.fn(),
  resetChannelWork: vi.fn(),
  appendMessage: vi.fn(),
  markExternalWrite: vi.fn(),
  updateTitle: vi.fn(),
  getWorkWithMessages: vi.fn(),
}))

vi.mock('../channels/channel-manager.js', () => ({ runChannelChat: mocks.runChannelChat }))
vi.mock('../channels/channel-permissions.js', () => ({
  CHANNEL_MYID_HINT: 'fixture hint',
  CHANNEL_EMPTY_REPLY_FALLBACK: 'fixture empty reply',
  getChannelPermissionMode: mocks.getChannelPermissionMode,
}))
vi.mock('../config.js', () => ({ getSettings: () => mocks.settings }))
vi.mock('../title-utils.js', () => ({ generateTitle: () => 'fixture title', generateTitleWithLLM: async () => null }))
vi.mock('../works-store.js', () => ({
  getLatestChannelNotifyTarget: mocks.getLatestChannelNotifyTarget,
  saveChannelNotifyTarget: mocks.saveChannelNotifyTarget,
  getOrCreateChannelWork: mocks.getOrCreateChannelWork,
  resetChannelWork: mocks.resetChannelWork,
  appendMessage: mocks.appendMessage,
  markExternalWrite: mocks.markExternalWrite,
  updateTitle: mocks.updateTitle,
  getWorkWithMessages: mocks.getWorkWithMessages,
}))
vi.mock('../logger.js', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

import { WeixinChannel, createDefaultWeixinProfile } from '../channels/weixin-channel.js'
import type { ChannelProfile } from '../channels/channel-profile.js'

type Sent = { to: string; text: string }

/** Records accepted bot messages. `reject` simulates iLink refusing a message (stale context_token → ret=-2). */
function captureFetch(reject: (text: string, contextToken: string) => boolean = () => false) {
  const sent: Sent[] = []
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    if (String(url).includes('ilink/bot/sendmessage')) {
      const body = JSON.parse(init?.body ?? '{}')
      const text = body.msg.item_list?.[0]?.text_item?.text ?? ''
      if (reject(text, body.msg.context_token)) return new Response(JSON.stringify({ ret: -2, errmsg: 'prepare failed' }), { status: 200 })
      sent.push({ to: body.msg.to_user_id, text })
    }
    return new Response(JSON.stringify({ ret: 0 }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return sent
}

const inbound = (text: string, from = 'owner-user', contextToken = `ctx-${from}`) => ({ from_user_id: from, context_token: contextToken, item_list: [{ type: 1, text_item: { text } }] })

function agentProfile(overrides: Partial<ChannelProfile> = {}): ChannelProfile {
  return {
    channelKey: 'agent:fixture',
    serializeTurns: true,
    titleLabel: () => 'Example Operations Assistant',
    welcomeText: () => '',
    authorize: (userId) => userId === 'owner-user'
      ? { kind: 'allow', mode: 'full' }
      : { kind: 'reply', text: '只为它的主人服务' },
    memoryScope: (userId) => ({ user: `weixin:${userId}`, project: 'agent:fixture' }),
    chatOptions: () => ({ appendSystemPrompt: 'fixture agent prompt' }),
    helpText: () => 'fixture help',
    onWorkCreated: vi.fn(),
    ...overrides,
  }
}

// Inbound handling is private; tests drive it the same way the poll loop does.
const handle = (channel: WeixinChannel, msg: ReturnType<typeof inbound>) =>
  (channel as unknown as { _handleInbound(m: unknown): Promise<void> })._handleInbound(msg)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.settings.api_key = 'placeholder-model-key'
  mocks.getOrCreateChannelWork.mockReturnValue({ work: { id: 'work-1', title: '' }, created: true })
  mocks.resetChannelWork.mockReturnValue({ id: 'work-2' })
  mocks.getWorkWithMessages.mockReturnValue({ messages: [{ role: 'user', content: 'question' }] })
  mocks.runChannelChat.mockResolvedValue({ text: 'fixture answer', images: [], toolCalls: [], timing: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WeChat channel with a dedicated agent profile', () => {
  it('keeps new and reset conversations in the dedicated project', async () => {
    captureFetch()
    const channel = new WeixinChannel({ token: 'placeholder-token' }, agentProfile({ projectId: () => 'fixture-project' }))
    await handle(channel, inbound('hello'))
    expect(mocks.getOrCreateChannelWork).toHaveBeenCalledWith('agent:fixture', 'owner-user', '', 'fixture-project')
    await handle(channel, inbound('/new'))
    expect(mocks.resetChannelWork).toHaveBeenCalledWith('agent:fixture', 'owner-user', '', 'fixture-project')
  })

  it('answers strangers from the profile without running the agent', async () => {
    const sent = captureFetch()
    const channel = new WeixinChannel({ token: 'placeholder-token' }, agentProfile())
    await handle(channel, inbound('hello', 'stranger'))
    expect(sent).toEqual([{ to: 'stranger', text: '只为它的主人服务' }])
    expect(mocks.runChannelChat).not.toHaveBeenCalled()
    expect(mocks.saveChannelNotifyTarget).not.toHaveBeenCalled()
  })

  it('runs the owner turn with the profile key, memory scope and agent options', async () => {
    const sent = captureFetch()
    const profile = agentProfile()
    const channel = new WeixinChannel({ token: 'placeholder-token' }, profile)
    await handle(channel, inbound('check stock'))
    expect(mocks.getOrCreateChannelWork).toHaveBeenCalledWith('agent:fixture', 'owner-user', '', null)
    expect(profile.onWorkCreated).toHaveBeenCalledWith('work-1')
    expect(mocks.updateTitle).toHaveBeenCalledWith('work-1', '（Example Operations Assistant）fixture title')
    const options = mocks.runChannelChat.mock.calls[0][2]
    expect(options).toMatchObject({
      channelPermissionMode: 'full',
      memoryScope: { user: 'weixin:owner-user', project: 'agent:fixture' },
      profileOptions: { appendSystemPrompt: 'fixture agent prompt' },
    })
    expect(options.abortController).toBeInstanceOf(AbortController)
    expect(sent.at(-1)).toEqual({ to: 'owner-user', text: 'fixture answer' })
  })

  it('handles /help, /new and full-width /stop', async () => {
    const sent = captureFetch()
    const profile = agentProfile()
    const channel = new WeixinChannel({ token: 'placeholder-token' }, profile)
    await handle(channel, inbound('/help'))
    await handle(channel, inbound('／stop'))
    await handle(channel, inbound('新对话'))
    expect(sent.map((entry) => entry.text)).toEqual(['fixture help', '当前没有正在执行的任务。', '已开启新对话 ✓'])
    expect(mocks.resetChannelWork).toHaveBeenCalledWith('agent:fixture', 'owner-user', '', null)
    expect(profile.onWorkCreated).toHaveBeenCalledWith('work-2')
    expect(mocks.runChannelChat).not.toHaveBeenCalled()
  })

  it('/stop interrupts a running turn and the stopped turn sends nothing more', async () => {
    const sent = captureFetch()
    let release!: () => void
    mocks.runChannelChat.mockImplementation((_messages: unknown, _settings: unknown, opts: { abortController: AbortController }) => new Promise((resolve) => {
      release = () => resolve({ text: opts.abortController.signal.aborted ? 'partial' : 'full', images: [], toolCalls: [], timing: null })
    }))
    const channel = new WeixinChannel({ token: 'placeholder-token' }, agentProfile())
    const running = handle(channel, inbound('long task'))
    await vi.waitFor(() => expect(mocks.runChannelChat).toHaveBeenCalled())

    await handle(channel, inbound('another request'))
    expect(sent.at(-1)?.text).toContain('上一个请求还在处理中')

    await handle(channel, inbound('/stop'))
    expect(sent.at(-1)?.text).toBe('已停止当前任务。')
    release()
    await running
    expect(sent.map((entry) => entry.text)).not.toContain('partial')
    const saved = mocks.appendMessage.mock.calls.at(-1)?.[2]
    expect(saved?.at(-1)).toEqual({ type: 'text', text: '（已停止）' })
  })

  it('sends at most two progress notices during a long turn instead of pinging every few seconds', async () => {
    vi.useFakeTimers()
    try {
      const sent = captureFetch()
      let release!: () => void
      mocks.runChannelChat.mockImplementation(() => new Promise((resolve) => {
        release = () => resolve({ text: 'fixture answer', images: [], toolCalls: [], timing: null })
      }))
      const channel = new WeixinChannel({ token: 'placeholder-token' }, agentProfile())
      const running = handle(channel, inbound('long task'))
      await vi.advanceTimersByTimeAsync(14_000)
      expect(sent).toEqual([])
      await vi.advanceTimersByTimeAsync(2_000)
      expect(sent.map((entry) => entry.text)).toEqual(['正在处理，请稍候…'])
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect(sent).toHaveLength(2)
      expect(sent[1].text).toContain('补发')
      release()
      await running
      expect(sent.map((entry) => entry.text).at(-1)).toBe('fixture answer')
      expect(sent.filter((entry) => entry.text.startsWith('正在处理'))).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an answer WeChat refused (stale context_token) and sends it with the next message', async () => {
    // The first message's token expires before the answer is ready.
    const sent = captureFetch((_text, contextToken) => contextToken === 'ctx-expired')
    const channel = new WeixinChannel({ token: 'placeholder-token' }, agentProfile())
    await handle(channel, inbound('long task', 'owner-user', 'ctx-expired'))
    expect(sent).toEqual([])
    expect(mocks.runChannelChat).toHaveBeenCalledTimes(1)

    // "结果" only fetches the pending answer; it does not start a new turn.
    await handle(channel, inbound('结果', 'owner-user', 'ctx-fresh'))
    expect(sent).toEqual([{ to: 'owner-user', text: '（补发上一个任务的结果）\nfixture answer' }])
    expect(mocks.runChannelChat).toHaveBeenCalledTimes(1)

    // Nothing is pending any more: the next message is a normal question.
    await handle(channel, inbound('next question', 'owner-user', 'ctx-fresh-2'))
    expect(mocks.runChannelChat).toHaveBeenCalledTimes(2)
    expect(sent.at(-1)?.text).toBe('fixture answer')
  })

  it('delivers a pending answer before handling a new question', async () => {
    const sent = captureFetch((_text, contextToken) => contextToken === 'ctx-expired')
    mocks.runChannelChat
      .mockResolvedValueOnce({ text: 'first answer', images: [], toolCalls: [], timing: null })
      .mockResolvedValueOnce({ text: 'second answer', images: [], toolCalls: [], timing: null })
    const channel = new WeixinChannel({ token: 'placeholder-token' }, agentProfile())
    await handle(channel, inbound('first', 'owner-user', 'ctx-expired'))
    await handle(channel, inbound('second', 'owner-user', 'ctx-fresh'))
    expect(sent.map((entry) => entry.text)).toEqual(['（补发上一个任务的结果）\nfirst answer', 'second answer'])
  })

  it('keeps the default main-channel behavior', async () => {
    const sent = captureFetch()
    const profile = createDefaultWeixinProfile()
    expect(profile.channelKey).toBe('weixin')
    expect(profile.memoryScope('someone')).toEqual({ user: 'weixin:someone' })
    const channel = new WeixinChannel({ token: 'placeholder-token' })
    await handle(channel, inbound('hello', 'someone'))
    expect(mocks.getChannelPermissionMode).toHaveBeenCalledWith('weixin', 'someone')
    expect(mocks.saveChannelNotifyTarget).toHaveBeenCalledWith('weixin', 'someone', { user_id: 'someone', context_token: 'ctx-someone' })
    expect(mocks.updateTitle).toHaveBeenCalledWith('work-1', '（微信）fixture title')
    expect(mocks.runChannelChat.mock.calls[0][2]).toMatchObject({ channelPermissionMode: 'qa_only', memoryScope: { user: 'weixin:someone' } })
    expect(sent.at(-1)?.text).toBe('fixture answer')
  })
})
