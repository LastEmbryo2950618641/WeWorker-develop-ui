import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../config.js'
import { BUILTIN_DEV_PROVIDER, BUILTIN_PROVIDER, activateBuiltinProvider, builtinProviderAccess, getBuiltinApiKey, publicBuiltinProviders, resolveBuiltinSettings } from '../builtin-provider.js'
import { getProvider, PROVIDERS } from '../provider-registry.js'
import { buildAnthropicAuthHeaders } from '../anthropic-auth.js'
import { probeMainConnection, probeProviderProtocol } from '../provider-model-services.js'
import { resolveWebwrightModelConfig } from '../webwright-model-config.js'

const env = {
  WEWORKER_BUILTIN_API_KEY: 'fixture-builtin-key',
  WEWORKER_BUILTIN_DEV_API_KEY: 'fixture-dev-key',
  WEWORKER_BUILTIN_DEV_BASE_URL: 'https://example.com/managed',
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('managed built-in models', () => {
  it('registers public metadata without deployment-only endpoints or credentials', () => {
    expect(getProvider('builtin')).toEqual(BUILTIN_PROVIDER)
    expect(getProvider('builtin_dev')).toEqual(BUILTIN_DEV_PROVIDER)
    expect(getProvider('builtin_dev')?.weworker.baseUrl).toBe('')
    expect(JSON.stringify(PROVIDERS)).not.toContain(env.WEWORKER_BUILTIN_API_KEY)
    expect(JSON.stringify(PROVIDERS)).not.toContain(env.WEWORKER_BUILTIN_DEV_BASE_URL)
  })

  it('reports embedded-provider availability without exposing either credential', () => {
    const providers = [BUILTIN_PROVIDER, BUILTIN_DEV_PROVIDER]
    expect(publicBuiltinProviders(providers, {})).toMatchObject({ builtin: { has_key: true, readonly: true }, builtin_dev: { has_key: true } })
    const ready = publicBuiltinProviders(providers, env)
    expect(ready.builtin.has_key).toBe(true)
    expect(ready.builtin_dev.has_key).toBe(true)
    expect(JSON.stringify(ready)).not.toContain('fixture-')
    expect(publicBuiltinProviders([], env)).toEqual({})
  })

  it('uses embedded credentials by default and accepts deployment overrides', () => {
    expect(getBuiltinApiKey('builtin', {})).not.toBe('')
    expect(getBuiltinApiKey('builtin_dev', {})).not.toBe('')
    expect(getBuiltinApiKey('builtin', env)).toBe(env.WEWORKER_BUILTIN_API_KEY)
    expect(builtinProviderAccess(BUILTIN_DEV_PROVIDER, { WEWORKER_BUILTIN_API_KEY: 'fixture-other-key' }).apiKey).not.toBe('')
    expect(builtinProviderAccess(BUILTIN_DEV_PROVIDER, { WEWORKER_BUILTIN_DEV_API_KEY: 'fixture-dev-key' }).apiKey).toBe('fixture-dev-key')
  })

  it('persists only the selection and resolves the fixed runtime values separately', () => {
    vi.stubEnv('WEWORKER_BUILTIN_API_KEY', env.WEWORKER_BUILTIN_API_KEY)
    const patch = activateBuiltinProvider(BUILTIN_PROVIDER, env)
    expect(patch.api_key).toBe('')
    const saved = { custom_auth_type: 'api_key', ...patch } as Settings
    const runtime = resolveBuiltinSettings(saved, PROVIDERS, env)
    expect(runtime.api_key).toBe(env.WEWORKER_BUILTIN_API_KEY)
    expect(runtime.model).toBe(BUILTIN_PROVIDER.defaultModel)
    expect(saved.api_key).toBe('')
    expect(resolveWebwrightModelConfig(runtime)).toMatchObject({
      provider_id: 'builtin', protocol: 'openai_chat_completions',
      base_url: BUILTIN_PROVIDER.webwright.baseUrl, api_key: env.WEWORKER_BUILTIN_API_KEY,
    })
    expect(buildAnthropicAuthHeaders(runtime.api_key, 'builtin', 'api_key')).toEqual({ authorization: 'Bearer fixture-builtin-key' })
  })

  it('isolates deployment model keys and keeps profile exclusions closed', () => {
    const saved = { active_provider: 'builtin_dev', api_key: 'fixture-stale-key', base_url: 'https://example.org/stale' } as Settings
    expect(resolveBuiltinSettings(saved, [BUILTIN_DEV_PROVIDER], env)).toMatchObject({ api_key: 'fixture-dev-key', base_url: 'https://example.com/managed' })
    expect(resolveBuiltinSettings(saved, PROVIDERS, env)).toMatchObject({ api_key: 'fixture-dev-key', base_url: 'https://example.com/managed' })
    expect(resolveBuiltinSettings(saved, [BUILTIN_PROVIDER], env)).toMatchObject({ api_key: '', base_url: '', model: '' })
    expect(resolveBuiltinSettings({ ...saved, active_provider: 'builtin' }, PROVIDERS, {}).api_key).not.toBe('')
  })

  it('preserves custom settings and independent exploration settings', () => {
    vi.stubEnv('WEWORKER_BUILTIN_API_KEY', env.WEWORKER_BUILTIN_API_KEY)
    const custom = { active_provider: 'custom', api_key: 'fixture-custom-key' } as Settings
    expect(resolveBuiltinSettings(custom, PROVIDERS, env)).toBe(custom)
    const runtime = resolveBuiltinSettings({ ...activateBuiltinProvider(BUILTIN_PROVIDER, env),
      exploration_base_url: 'https://example.org/v1', exploration_use_main_key: false,
      exploration_api_key: 'fixture-independent-key', exploration_model: 'fixture-independent-model',
    } as Settings, PROVIDERS, env)
    expect(resolveWebwrightModelConfig(runtime)).toMatchObject({ base_url: 'https://example.org/v1', api_key: 'fixture-independent-key', model: 'fixture-independent-model' })
  })

  it('probes both protocols with the deployment credential and redacts reflected errors', async () => {
    const input = builtinProviderAccess(BUILTIN_PROVIDER, env)
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ content: [{ type: 'tool_use', name: 'connection_check', input: { ok: true } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }))
      .mockResolvedValueOnce(new Response('invalid fixture-builtin-key', { status: 401 }))
    expect((await probeMainConnection(input, fetchMock)).ok).toBe(true)
    expect((await probeProviderProtocol({ ...input, target: 'webwright', verifyResponse: true }, fetchMock)).ok).toBe(true)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${BUILTIN_PROVIDER.weworker.baseUrl}/v1/messages`, `${BUILTIN_PROVIDER.webwright.baseUrl}/chat/completions`,
    ])
    for (const [, init] of fetchMock.mock.calls) expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-builtin-key')
    const failure = await probeMainConnection(input, fetchMock)
    expect(failure.ok).toBe(false)
    expect(failure.detail).not.toContain('fixture-builtin-key')
  })

  it('does not reinsert built-ins excluded by a build profile', async () => {
    vi.stubGlobal('__BUILD_PROVIDERS__', [])
    vi.resetModules()
    const registry = await import('../provider-registry.js')
    expect(registry.PROVIDERS).toEqual([])
    expect(registry.getProvider('builtin')).toBeUndefined()
  })
})
