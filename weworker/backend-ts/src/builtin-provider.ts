import type { Settings } from './config.js'
import { createDecipheriv } from 'node:crypto'
import { DEFAULT_CONTEXT_LIMIT } from './context-window.js'
import { normalizeLlmBaseUrl, type ProviderEntry } from './llm-egress.js'

// Public provider metadata only. Credential material remains private to this module.
export const BUILTIN_PROVIDER: ProviderEntry = {
  id: 'builtin',
  name: '内置模型',
  models: ['ark-code-latest'],
  defaultModel: 'ark-code-latest',
  weworker: { protocol: 'anthropic_messages', baseUrl: 'https://ark.cn-beijing.volces.com/api/plan' },
  webwright: { protocol: 'openai_chat_completions', modelClass: 'zhipu', baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3', structuredOutput: 'openai_json_object' },
}

// The endpoint is resolved only when this provider is used, so settings APIs
// and renderer metadata never receive it.
export const BUILTIN_DEV_PROVIDER: ProviderEntry = {
  id: 'builtin_dev',
  name: '内置模型（开发）',
  models: ['deepseek-v4-flash'],
  defaultModel: 'deepseek-v4-flash',
  weworker: { protocol: 'anthropic_messages', baseUrl: '' },
  webwright: { protocol: 'anthropic_messages', modelClass: 'anthropic', baseUrl: '', structuredOutput: 'anthropic_json_schema' },
}

export const BUILTIN_PROVIDERS: ProviderEntry[] = [BUILTIN_PROVIDER, BUILTIN_DEV_PROVIDER]

const EMBEDDED_SECRET_KEY = Buffer.from('33cfebfe2c3549b3de27164524c466c12dd9caac3f2f7fac50cf076b8b5b0b6f', 'hex')
const EMBEDDED_SECRETS = {
  builtin: 'KblwyJ8H-s6noP51.8CHYHFuC2Ry2BHjvRIby9g.OQVfEBpevOgdzHsJbpAS7lEJrTa-k1Ua4r77Uy3zMxZ0yRQnIEQy-EFyOu2YqA',
  builtin_dev: 'q3iCt7pfm3Pl6f9d.eqpJWf0ivJaNijO28M30lQ.8uA0XScKmGMO9Iv8G4VA66XCz9RGvQ0TvQ',
  builtin_dev_base_url: 'PY9VxSj_gvqEjoGY.zhSELoqJYreGYQ_oVyKVTA.7_0LiCEO9X1yHE2mQFHPh0d8RA',
} as const

function decryptEmbeddedSecret(payload: string): string {
  const [iv, authTag, encrypted] = payload.split('.')
  if (!iv || !authTag || !encrypted) throw new Error('内置模型配置无效')
  const decipher = createDecipheriv('aes-256-gcm', EMBEDDED_SECRET_KEY, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(authTag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')
}

export function isBuiltinProvider(id: string | undefined): boolean {
  return id === 'builtin' || id === 'builtin_dev'
}

export function getBuiltinApiKey(id: string, env: NodeJS.ProcessEnv = process.env): string {
  const variable = id === 'builtin' ? 'WEWORKER_BUILTIN_API_KEY'
    : id === 'builtin_dev' ? 'WEWORKER_BUILTIN_DEV_API_KEY' : ''
  const override = variable ? (env[variable] || '').trim() : ''
  if (override) return override
  if (id === 'builtin') return decryptEmbeddedSecret(EMBEDDED_SECRETS.builtin)
  if (id === 'builtin_dev') return decryptEmbeddedSecret(EMBEDDED_SECRETS.builtin_dev)
  return ''
}

function getBuiltinRuntimeProvider(provider: ProviderEntry, env: NodeJS.ProcessEnv = process.env): ProviderEntry {
  if (provider.id !== 'builtin_dev') return provider
  const baseUrl = (env.WEWORKER_BUILTIN_DEV_BASE_URL || '').trim()
    || decryptEmbeddedSecret(EMBEDDED_SECRETS.builtin_dev_base_url)
  if (!baseUrl) throw new Error('内置模型服务尚未配置，请联系应用提供方或使用其他模型')
  const normalized = normalizeLlmBaseUrl(baseUrl)
  return {
    ...provider,
    weworker: { ...provider.weworker, baseUrl: normalized },
    webwright: { ...provider.webwright, baseUrl: normalized },
  }
}

export function isBuiltinProviderConfigured(provider: ProviderEntry, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!getBuiltinApiKey(provider.id, env)) return false
  try {
    getBuiltinRuntimeProvider(provider, env)
    return true
  } catch {
    return false
  }
}

export function publicBuiltinProviders(providers: ProviderEntry[], env: NodeJS.ProcessEnv = process.env) {
  return Object.fromEntries(providers.filter(p => isBuiltinProvider(p.id)).map(p => [p.id, {
    has_key: isBuiltinProviderConfigured(p, env),
    model: p.defaultModel,
    context_limit: DEFAULT_CONTEXT_LIMIT,
    readonly: true,
  }]))
}

export function builtinProviderAccess(provider: ProviderEntry, env: NodeJS.ProcessEnv = process.env) {
  if (!isBuiltinProvider(provider.id)) throw new Error('不是内置模型')
  const apiKey = getBuiltinApiKey(provider.id, env)
  if (!apiKey) throw new Error('内置模型服务尚未配置，请联系应用提供方或使用其他模型')
  const runtimeProvider = getBuiltinRuntimeProvider(provider, env)
  return {
    provider: runtimeProvider,
    apiKey,
    model: runtimeProvider.defaultModel,
    anthropicBaseUrl: runtimeProvider.weworker.baseUrl,
    openaiBaseUrl: runtimeProvider.webwright.baseUrl,
    anthropicAuthType: runtimeProvider.id === 'builtin' ? 'auth_token' as const : 'api_key' as const,
  }
}

export function activateBuiltinProvider(provider: ProviderEntry, env: NodeJS.ProcessEnv = process.env): Partial<Settings> {
  const access = builtinProviderAccess(provider, env)
  return {
    active_provider: access.provider.id,
    active_model_configuration: '',
    active_auth_type: access.anthropicAuthType,
    // Only the selection is persisted. The deployment credential stays in memory.
    api_key: '',
    base_url: '',
    base_url_is_full: false,
    model: access.provider.defaultModel,
    context_limit: DEFAULT_CONTEXT_LIMIT,
  }
}

export function resolveBuiltinSettings(settings: Settings, providers: ProviderEntry[], env: NodeJS.ProcessEnv = process.env): Settings {
  if (!isBuiltinProvider(settings.active_provider)) return settings
  const provider = providers.find(p => p.id === settings.active_provider)
  let access: ReturnType<typeof builtinProviderAccess> | undefined
  try {
    if (provider) access = builtinProviderAccess(provider, env)
  } catch {
    access = undefined
  }
  return {
    ...settings,
    // Never reuse a stale saved key or address, especially when a profile excludes the provider.
    api_key: access?.apiKey || '',
    base_url: access?.provider.weworker.baseUrl || '',
    base_url_is_full: false,
    model: access?.provider.defaultModel || '',
    active_auth_type: access?.anthropicAuthType || settings.active_auth_type,
    context_limit: DEFAULT_CONTEXT_LIMIT,
  }
}
