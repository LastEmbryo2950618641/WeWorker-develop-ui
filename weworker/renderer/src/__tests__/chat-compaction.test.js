import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isContextOverflowError, shouldAutoCompactAfterTurn, streamChat } from '../api/backend.js'

const originalFetch = global.fetch
const originalWindow = global.window

function createChunkReader(text) {
  const bytes = new TextEncoder().encode(text)
  let consumed = false
  return {
    async read() {
      if (consumed) return { done: true, value: undefined }
      consumed = true
      return { done: false, value: bytes }
    },
  }
}

function createSseResponse(events) {
  const payload = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
  return {
    ok: true,
    status: 200,
    body: { getReader: () => createChunkReader(payload) },
    json: async () => ({}),
  }
}

function createJsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    body: { getReader: () => createChunkReader('') },
    json: async () => payload,
  }
}

afterEach(() => {
  global.fetch = originalFetch
  global.window = originalWindow
})

describe('chat compaction triggers', () => {
  for (const trigger of ['threshold', 'http-overflow', 'sse-overflow']) {
    it(`shows compaction start while ${trigger} compression is pending and waits before continuing`, async () => {
      const events = []
      let chatRequests = 0
      let releaseCompaction
      let markCompactionRequested
      const pendingCompaction = new Promise(resolve => { releaseCompaction = resolve })
      const compactionRequested = new Promise(resolve => { markCompactionRequested = resolve })
      global.window = {}
      global.fetch = async (url) => {
        if (String(url).endsWith('/compact')) {
          markCompactionRequested()
          return pendingCompaction
        }
        chatRequests += 1
        if (chatRequests > 1) {
          assert.equal(events.at(-1)?.type, 'context_compaction_end')
          return createSseResponse([])
        }
        if (trigger === 'http-overflow') return createJsonResponse({ detail: 'context length exceeded' }, false, 413)
        if (trigger === 'sse-overflow') return createSseResponse([{ type: 'error', content: 'context length exceeded' }])
        return createSseResponse([{ type: 'context_snapshot', context: { actual_input_tokens: 900, context_limit: 1000 } }])
      }
      let finished = false
      const request = streamChat('work-1', '继续', event => events.push(event), new AbortController().signal)
        .then(() => { finished = true })
      await compactionRequested
      try {
        assert.equal(events.at(-1)?.type, 'context_compaction_start')
        assert.equal(events.some(event => event.type === 'context_compaction_end'), false)
        assert.equal(chatRequests, 1)
        assert.equal(finished, false)
      } finally {
        releaseCompaction(createJsonResponse({ status: 'completed', events: [{ type: 'context_compaction_end', compaction: { status: 'completed' } }] }))
        await request
      }
      assert.equal(events.some(event => event.type === 'context_compaction_end'), true)
      assert.equal(chatRequests, trigger === 'threshold' ? 1 : 2)
    })
  }

  it('triggers after a provider-calibrated turn reaches 90 percent', () => {
    assert.equal(shouldAutoCompactAfterTurn({ actual_input_tokens: 900, context_limit: 1000 }), true)
    assert.equal(shouldAutoCompactAfterTurn({ actual_input_tokens: 899, context_limit: 1000 }), false)
  })

  it('uses the complete provider input token total when categories are present', () => {
    assert.equal(shouldAutoCompactAfterTurn({
      actual_input_tokens: 950,
      context_limit: 1000,
      categories: [
        { id: 'rules', estimated_tokens: 700, calibrated_tokens: 700 },
        { id: 'conversation', estimated_tokens: 250, calibrated_tokens: 250 },
      ],
    }), true)
    assert.equal(shouldAutoCompactAfterTurn({
      actual_input_tokens: 900,
      context_limit: 1000,
      categories: [
        { id: 'rules', estimated_tokens: 200, calibrated_tokens: 200 },
        { id: 'conversation', estimated_tokens: 720, calibrated_tokens: 720 },
      ],
    }), true)
  })

  it('does not trigger a second automatic compaction during retry', () => {
    assert.equal(shouldAutoCompactAfterTurn({ actual_input_tokens: 1000, context_limit: 1000 }, true), false)
    assert.equal(shouldAutoCompactAfterTurn({ actual_input_tokens: 1000, context_limit: 1000 }, false, true), false)
  })

  it('recognizes provider context overflow errors', () => {
    assert.equal(isContextOverflowError('prompt is too long for the context window'), true)
    assert.equal(isContextOverflowError('network request failed'), false)
  })

  it('does not treat output limits or rate limits as context overflow', () => {
    assert.equal(isContextOverflowError('max_tokens exceeds the output token limit'), false)
    assert.equal(isContextOverflowError('token rate limit exceeded'), false)
    assert.equal(isContextOverflowError('context_length_exceeded'), true)
    assert.equal(isContextOverflowError('上下文长度超出限制'), true)
  })

  it('reports an SSE overflow when compaction is skipped instead of hiding the failure', async () => {
    const events = []
    let chatRequests = 0
    global.window = {}
    global.fetch = async (url) => {
      if (String(url).endsWith('/chat')) {
        chatRequests += 1
        return createSseResponse([{ type: 'error', content: 'context length exceeded' }])
      }
      return createJsonResponse({ status: 'skipped', events: [{ type: 'context_compaction_end', compaction: { status: 'skipped' } }] })
    }
    await streamChat('work-1', '继续', event => events.push(event), new AbortController().signal)
    assert.equal(chatRequests, 1)
    assert.equal(events.some(event => event.type === 'error'), true)
  })

  it('auto-compacts once the real token usage crosses the threshold', async () => {
    const events = []
    const fetchCalls = []
    global.window = { electronAPI: { getHttpAuthToken: async () => '' } }
    global.fetch = async (url, options = {}) => {
      fetchCalls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null })
      if (String(url).endsWith('/works/work-1/chat')) {
        return createSseResponse([
          { type: 'context_snapshot', context: { actual_input_tokens: 900, context_limit: 1000 } },
        ])
      }
      if (String(url).endsWith('/works/work-1/compact')) {
        return createJsonResponse({
          ok: true,
          events: [
            { type: 'context_compaction_start', compaction: { status: 'started' } },
            { type: 'context_compaction_end', compaction: { status: 'completed' } },
          ],
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }

    await streamChat('work-1', '检查余额', (event) => events.push(event), new AbortController().signal)

    assert.equal(fetchCalls.filter((call) => call.url.endsWith('/works/work-1/chat')).length, 1)
    assert.equal(fetchCalls.filter((call) => call.url.endsWith('/works/work-1/compact')).length, 1)
    assert.equal(events.some((event) => event.type === 'context_compaction_start'), true)
    assert.equal(events.some((event) => event.type === 'context_compaction_end' && event.compaction?.status === 'completed'), true)
  })

  it('requests compaction when complete usage reaches 90 percent even if conversation is below its budget', async () => {
    const events = []
    const fetchCalls = []
    global.window = { electronAPI: { getHttpAuthToken: async () => '' } }
    global.fetch = async (url, options = {}) => {
      fetchCalls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null })
      if (String(url).endsWith('/works/work-1/chat')) {
        return createSseResponse([{
          type: 'context_snapshot',
          context: {
            actual_input_tokens: 950,
            context_limit: 1000,
            categories: [
              { id: 'rules', estimated_tokens: 700, calibrated_tokens: 700 },
              { id: 'conversation', estimated_tokens: 250, calibrated_tokens: 250 },
            ],
          },
        }])
      }
      if (String(url).endsWith('/works/work-1/compact')) {
        return createJsonResponse({
          ok: true,
          status: 'skipped',
          events: [{ type: 'context_compaction_end', compaction: { status: 'skipped', reason: 'no_droppable_history' } }],
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }

    await streamChat('work-1', '确认状态', (event) => events.push(event), new AbortController().signal)

    assert.equal(fetchCalls.filter((call) => call.url.endsWith('/works/work-1/compact')).length, 1)
    assert.equal(events.some((event) => event.type === 'context_compaction_start'), true)
  })

  it('surfaces a skipped compaction without treating it as a request failure', async () => {
    const events = []
    const fetchCalls = []
    global.window = { electronAPI: { getHttpAuthToken: async () => '' } }
    global.fetch = async (url, options = {}) => {
      fetchCalls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null })
      if (String(url).endsWith('/works/work-1/chat')) {
        return createSseResponse([
          { type: 'context_snapshot', context: { actual_input_tokens: 900, context_limit: 1000 } },
        ])
      }
      if (String(url).endsWith('/works/work-1/compact')) {
        return createJsonResponse({
          ok: true,
          status: 'skipped',
          events: [{ type: 'context_compaction_end', compaction: { status: 'skipped', reason: 'no_droppable_history' } }],
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }

    await streamChat('work-1', '确认状态', (event) => events.push(event), new AbortController().signal)

    assert.equal(fetchCalls.filter((call) => call.url.endsWith('/works/work-1/compact')).length, 1)
    assert.equal(events.some((event) => event.type === 'context_compaction_end' && event.compaction?.status === 'skipped'), true)
    assert.equal(events.some((event) => event.type === 'error'), false)
  })

  it('recovers when the chat endpoint returns an HTTP overflow error', async () => {
    const events = []
    const fetchCalls = []
    global.window = { electronAPI: { getHttpAuthToken: async () => '' } }
    global.fetch = async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null
      fetchCalls.push({ url: String(url), body })
      if (String(url).endsWith('/works/work-1/chat') && !body?.retryCompaction) {
        return createJsonResponse({ detail: 'context length exceeded' }, false, 413)
      }
      if (String(url).endsWith('/works/work-1/chat') && body?.retryCompaction) {
        return createSseResponse([])
      }
      if (String(url).endsWith('/works/work-1/compact')) {
        return createJsonResponse({ ok: true, events: [{ type: 'context_compaction_end', compaction: { status: 'completed' } }] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }

    await streamChat('work-1', '压缩后继续', (event) => events.push(event), new AbortController().signal)

    assert.equal(fetchCalls.filter((call) => call.url.endsWith('/works/work-1/chat')).length, 2)
    assert.equal(fetchCalls.filter((call) => call.url.endsWith('/works/work-1/compact')).length, 1)
    assert.equal(events.some((event) => event.type === 'context_compaction_start'), true)
    assert.equal(events.some((event) => event.type === 'context_compaction_end' && event.compaction?.status === 'completed'), true)
  })

  it('surfaces a second context overflow instead of retrying forever', async () => {
    const events = []
    let chatRequests = 0
    global.window = { electronAPI: { getHttpAuthToken: async () => '' } }
    global.fetch = async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null
      if (String(url).endsWith('/works/work-1/chat')) {
        chatRequests += 1
        return createSseResponse([{ type: 'error', content: 'context window exceeded' }])
      }
      if (String(url).endsWith('/works/work-1/compact')) {
        return createJsonResponse({ ok: true, events: [{ type: 'context_compaction_end', compaction: { status: 'completed' } }] })
      }
      throw new Error(`unexpected fetch: ${url} ${JSON.stringify(body)}`)
    }

    await streamChat('work-1', '继续查询', (event) => events.push(event), new AbortController().signal)

    assert.equal(chatRequests, 2)
    assert.equal(events.some((event) => event.type === 'error' && event.content === 'context window exceeded'), true)
  })

  it('retries after a context overflow error and skips a second auto compact', async () => {
    const events = []
    const fetchCalls = []
    global.window = { electronAPI: { getHttpAuthToken: async () => '' } }
    global.fetch = async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null
      fetchCalls.push({ url: String(url), body })
      if (String(url).endsWith('/works/work-1/chat') && !body?.retryCompaction) {
        return createSseResponse([
          { type: 'error', content: 'context window exceeded' },
        ])
      }
      if (String(url).endsWith('/works/work-1/chat') && body?.retryCompaction) {
        return createSseResponse([
          { type: 'context_snapshot', context: { actual_input_tokens: 850, context_limit: 1000 } },
        ])
      }
      if (String(url).endsWith('/works/work-1/compact')) {
        return createJsonResponse({
          ok: true,
          events: [
            { type: 'context_compaction_start', compaction: { status: 'started' } },
            { type: 'context_compaction_end', compaction: { status: 'completed' } },
          ],
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }

    await streamChat('work-1', '查询最近消费', (event) => events.push(event), new AbortController().signal)

    const chatBodies = fetchCalls.filter((call) => call.url.endsWith('/works/work-1/chat')).map((call) => call.body)
    assert.equal(chatBodies.length, 2)
    assert.equal(chatBodies[0].retryCompaction, false)
    assert.equal(chatBodies[1].retryCompaction, true)
    assert.equal(fetchCalls.filter((call) => call.url.endsWith('/works/work-1/compact')).length, 1)
    assert.equal(events.some((event) => event.type === 'context_compaction_start'), true)
    assert.equal(events.some((event) => event.type === 'context_compaction_end' && event.compaction?.status === 'completed'), true)
  })
})
