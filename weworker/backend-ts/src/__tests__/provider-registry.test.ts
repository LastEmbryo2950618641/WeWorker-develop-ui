import { describe, expect, it, vi } from 'vitest'
import { getProvider, findProviderByWeWorkerBaseUrl } from '../provider-registry.js'
import { listProviderModels, probeProviderProtocol } from '../provider-model-services.js'

function provider(id: string) {
  const value = getProvider(id)
  if (!value) throw new Error(`missing provider ${id}`)
  return value
}

describe('provider model catalog', () => {
  it('ignores providers without a valid configured URL when recognizing a custom address', () => {
    expect(findProviderByWeWorkerBaseUrl('https://example.com')).toBeUndefined()
    expect(findProviderByWeWorkerBaseUrl('https://api.deepseek.com/anthropic/')?.id).toBe('deepseek')
  })

  it('keeps model names out of the build config so the catalog stays authoritative', () => {
    // 供应商只写死构建期路由与安全配置；模型名一律来自模型列表接口或用户手填，
    // 否则供应商改名/上下架时会固化出一个接口里不存在的「当前模型」。
    for (const id of ['anthropic', 'glm', 'deepseek', 'custom']) {
      const entry = provider(id)
      expect(entry.models).toEqual([])
      expect(entry.defaultModel).toBe('')
    }
    // 内置模型是固定服务、没有列表接口，保留其内置模型名。
    expect(provider('builtin').defaultModel).not.toBe('')
  })

  it.each(['weworker', 'webwright'] as const)('honors an explicit %s catalog even when the conversation URL matches a preset', async target => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: 'fixture-model' }] }))
    await listProviderModels({ provider: provider('custom'), target,
      anthropicBaseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'fixture-main-key',
      modelsUrl: 'https://example.com/models', modelsAuthType: 'api_key',
      openaiModelsUrl: 'https://example.org/models', openaiApiKey: 'fixture-exploration-key',
    }, fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(target === 'weworker' ? 'https://example.com/models' : 'https://example.org/models')
    const headers = new Headers(options?.headers)
    expect(headers.get(target === 'weworker' ? 'x-api-key' : 'authorization'))
      .toBe(target === 'weworker' ? 'fixture-main-key' : 'Bearer fixture-exploration-key')
  })

  it('requires the targeted interface key and address before making a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    for (const input of [
      { target: 'webwright' as const, apiKey: 'fixture-main-key', openaiBaseUrl: 'https://example.org/v1' },
      { target: 'weworker' as const, apiKey: '', openaiApiKey: 'fixture-openai-key', anthropicBaseUrl: 'https://example.com' },
      { target: 'weworker' as const, apiKey: 'fixture-main-key' },
    ]) {
      const result = await listProviderModels({ provider: provider('custom'), ...input }, fetchImpl)
      expect(result).toMatchObject({ source: 'fallback', models: [] })
      expect(result.warning).toContain('地址和 API Key')
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['weworker', 'webwright'] as const)('fetches only the requested %s catalog using its own key', async target => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: 'fixture-remote' }] }))
    const result = await listProviderModels({
      provider: provider('custom'), target, apiKey: 'fixture-main-key', openaiApiKey: 'fixture-openai-key',
      anthropicBaseUrl: 'https://example.com/anthropic', openaiBaseUrl: 'https://example.org/v1',
    }, fetchMock)
    expect(result).toEqual({ source: 'remote', models: ['fixture-remote'] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(target === 'weworker' ? 'https://example.com/anthropic/v1/models?limit=1000' : 'https://example.org/v1/models')
    expect(new Headers(options?.headers).get('authorization')).toBe(target === 'weworker' ? 'Bearer fixture-main-key' : 'Bearer fixture-openai-key')
  })

  it.each([401, 403, 404, 503])('does not expose fallback choices as a fetched custom catalog on HTTP %s', async status => {
    const result = await listProviderModels({ provider: provider('custom'), target: 'weworker',
      apiKey: 'fixture-invalid-key', anthropicBaseUrl: 'https://example.com' }, vi.fn(async () => new Response('fixture failure', { status })))
    expect(result).toMatchObject({ source: 'fallback', models: [] })
    expect(result.warning).toContain(`HTTP ${status}`)
  })

  it('does not infer a model catalog address from a complete endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const result = await listProviderModels({ provider: provider('custom'), target: 'weworker', apiKey: 'fixture-key',
      anthropicBaseUrl: 'https://example.com/inference', anthropicFullUrl: true }, fetchMock)
    expect(result).toMatchObject({ source: 'fallback', models: [] })
    expect(result.warning).toContain('完整 URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses only the official response when the remote catalog succeeds', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'deepseek-remote-a' }, { id: 'deepseek-remote-b' }],
    }), { status: 200 })) as typeof fetch
    const result = await listProviderModels({
      provider: provider('deepseek'), apiKey: 'secret',
    }, fetchImpl)
    expect(result).toEqual({ models: ['deepseek-remote-a', 'deepseek-remote-b'], source: 'remote' })
    expect(fetchImpl).toHaveBeenCalledWith('https://api.deepseek.com/models', expect.anything())
  })

  it('never substitutes hardcoded choices when the remote catalog fails', async () => {
    const remoteBody = JSON.stringify({ error: { message: 'offline' }, request_id: 'req-catalog' })
    const fetchImpl = vi.fn(async () => new Response(remoteBody, { status: 503, statusText: 'Service Unavailable' })) as typeof fetch
    const result = await listProviderModels({
      provider: provider('deepseek'), apiKey: 'secret',
    }, fetchImpl)
    expect(result.source).toBe('fallback')
    // 模型名不再内置：拉取失败时列表为空，由用户在模型下拉里手填。
    expect(result.models).toEqual([])
    expect(result.warning).toBe(`OpenAI 接口：HTTP 503 Service Unavailable\n${remoteBody}`)
  })

  it('keeps the failed remote response when another custom catalog succeeds', async () => {
    const remoteBody = '<html>upstream unavailable</html>'
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).includes('/anthropic/')
      ? new Response(remoteBody, { status: 502, statusText: 'Bad Gateway' })
      : new Response(JSON.stringify({ data: [{ id: 'openai-model' }] }), { status: 200 })) as typeof fetch
    const result = await listProviderModels({
      provider: provider('custom'),
      apiKey: 'secret',
      anthropicBaseUrl: 'https://gateway.example/anthropic',
      openaiBaseUrl: 'https://gateway.example/openai/v1',
    }, fetchImpl)
    expect(result).toEqual({
      models: ['openai-model'],
      source: 'remote',
      warning: `Claude Code 接口：HTTP 502 Bad Gateway\n${remoteBody}`,
    })
  })

  it('treats an empty successful response as authoritative', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as typeof fetch
    await expect(listProviderModels({
      provider: provider('deepseek'), apiKey: 'secret',
    }, fetchImpl)).resolves.toEqual({ models: [], source: 'remote' })
  })

  it('merges successful custom Anthropic and OpenAI catalogs', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      data: String(input).includes('/anthropic/v1/models')
        ? [{ id: 'shared' }, { id: 'anthropic-only' }]
        : [{ id: 'shared' }, { id: 'openai-only' }],
    }), { status: 200 }))
    const result = await listProviderModels({
      provider: provider('custom'),
      apiKey: 'secret',
      anthropicBaseUrl: 'https://gateway.example/anthropic',
      openaiBaseUrl: 'https://gateway.example/openai/v1',
    }, fetchMock as typeof fetch)
    expect(result).toEqual({ models: ['shared', 'anthropic-only', 'openai-only'], source: 'remote' })
    const anthropicRequest = fetchMock.mock.calls.find(([url]) => String(url).includes('/anthropic/v1/models'))
    expect(new Headers(anthropicRequest?.[1]?.headers).get('authorization')).toBe('Bearer secret')
    expect(new Headers(anthropicRequest?.[1]?.headers).has('x-api-key')).toBe(false)
  })

  it('uses the matched built-in catalog route for a custom DeepSeek Anthropic base url', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      data: [{ id: 'deepseek-remote-a' }, { id: 'deepseek-remote-b' }],
    }))
    const result = await listProviderModels({
      provider: provider('custom'),
      apiKey: 'secret',
      anthropicBaseUrl: 'https://api.deepseek.com/anthropic',
    }, fetchMock)

    expect(result).toEqual({ models: ['deepseek-remote-a', 'deepseek-remote-b'], source: 'remote' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/models', expect.anything())
  })
})

describe('provider protocol probe', () => {
  it('probes the selected model through the Webwright protocol without catalog validation', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('{}', { status: 200 }))
    const fetchImpl = fetchMock as typeof fetch
    const result = await probeProviderProtocol({
      provider: provider('deepseek'),
      apiKey: 'secret',
      model: 'deepseek-chat',
      target: 'webwright',
    }, fetchImpl)
    expect(result).toEqual({
      ok: true,
      target: 'webwright',
      protocol: 'openai_chat_completions',
      model: 'deepseek-chat',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'deepseek-chat',
      response_format: { type: 'json_object' },
    })
  })

  it('returns a stable authentication error without changing configuration', async () => {
    const remoteBody = JSON.stringify({ error: { message: 'bad key' }, request_id: 'req-probe' })
    const fetchImpl = vi.fn(async () => new Response(remoteBody, { status: 401, statusText: 'Unauthorized' })) as typeof fetch
    const result = await probeProviderProtocol({
      provider: provider('anthropic'),
      apiKey: 'fixture-invalid-key',
      model: 'claude-current',
      target: 'weworker',
    }, fetchImpl)
    expect(result).toMatchObject({
      ok: false,
      error: 'auth_failed',
      model: 'claude-current',
      detail: `HTTP 401 Unauthorized\n${remoteBody}`,
    })
  })

  it('probes a custom Anthropic endpoint with bearer authentication', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('{}', { status: 200 }))
    const result = await probeProviderProtocol({
      provider: provider('custom'),
      apiKey: 'custom-token',
      anthropicBaseUrl: 'https://gateway.example',
      model: 'claude-current',
      target: 'weworker',
    }, fetchMock as typeof fetch)

    expect(result.ok).toBe(true)
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('authorization')).toBe('Bearer custom-token')
    expect(headers.has('x-api-key')).toBe(false)
  })

  it('probes a custom Anthropic endpoint with x-api-key authentication when selected', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('{}', { status: 200 }))
    const result = await probeProviderProtocol({
      provider: provider('custom'),
      apiKey: 'custom-key',
      anthropicBaseUrl: 'https://gateway.example',
      anthropicAuthType: 'api_key',
      model: 'claude-current',
      target: 'weworker',
    }, fetchMock as typeof fetch)

    expect(result.ok).toBe(true)
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('x-api-key')).toBe('custom-key')
    expect(headers.has('authorization')).toBe(false)
  })
})
