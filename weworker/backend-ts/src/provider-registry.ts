import { buildAllowedLlmBaseUrls, normalizeLlmBaseUrl, type ProviderEntry } from './llm-egress.js'
import { BUILTIN_PROVIDERS } from './builtin-provider.js'

declare const __BUILD_PROVIDERS__: ProviderEntry[]

// 供应商只写死构建期的路由与安全配置（协议、地址、认证、结构化输出）。
// 模型名属于供应商侧数据，这里不再内置列表与默认值，一律以模型列表接口为准。
const DEV_PROVIDERS: ProviderEntry[] = [
  ...BUILTIN_PROVIDERS,
  { id: 'anthropic', name: 'Anthropic', models: [], defaultModel: '', weworker: { protocol: 'anthropic_messages', baseUrl: 'https://api.anthropic.com' }, webwright: { protocol: 'anthropic_messages', modelClass: 'anthropic', baseUrl: 'https://api.anthropic.com', structuredOutput: 'anthropic_json_schema' } },
  { id: 'glm', name: '智谱 coding plan', models: [], defaultModel: '', weworker: { protocol: 'anthropic_messages', baseUrl: 'https://open.bigmodel.cn/api/anthropic' }, webwright: { protocol: 'openai_chat_completions', modelClass: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', structuredOutput: 'openai_json_object' } },
  { id: 'deepseek', name: 'DeepSeek', models: [], defaultModel: '', weworker: { protocol: 'anthropic_messages', baseUrl: 'https://api.deepseek.com/anthropic' }, webwright: { protocol: 'openai_chat_completions', modelClass: 'openai_chat', baseUrl: 'https://api.deepseek.com', structuredOutput: 'openai_json_object' } },
  { id: 'custom', name: '自定义', models: [], defaultModel: '', weworker: { protocol: 'anthropic_messages', baseUrl: '' }, webwright: { protocol: 'openai_chat_completions', modelClass: 'openai_chat', baseUrl: '', structuredOutput: 'openai_json_object' } },
]

export const PROVIDERS: ProviderEntry[] = typeof __BUILD_PROVIDERS__ !== 'undefined' ? __BUILD_PROVIDERS__ : DEV_PROVIDERS

export const PROVIDER_BASE_URLS: Record<string, string> = Object.fromEntries(
  PROVIDERS.map(p => [p.id, p.weworker.baseUrl])
)

export function getProvider(providerId: string): ProviderEntry | undefined {
  return PROVIDERS.find(provider => provider.id === providerId)
}

export function findProviderByWeWorkerBaseUrl(baseUrl: string | undefined): ProviderEntry | undefined {
  if (!baseUrl?.trim()) return undefined
  let normalized: string
  try {
    normalized = normalizeLlmBaseUrl(baseUrl)
  } catch {
    return undefined
  }
  return PROVIDERS.find(provider => {
    if (provider.id === 'custom' || !provider.weworker.baseUrl?.trim()) return false
    try {
      return normalizeLlmBaseUrl(provider.weworker.baseUrl) === normalized
    } catch {
      return false
    }
  })
}

export const ALLOWED_PROVIDER_IDS = new Set(PROVIDERS.map(p => p.id))
export const ALLOWED_LLM_BASE_URLS = buildAllowedLlmBaseUrls(PROVIDERS)

export function buildRuntimeAllowedLlmBaseUrls(...extraBaseUrls: Array<string | undefined>): Set<string> {
  return buildAllowedLlmBaseUrls(PROVIDERS, extraBaseUrls.filter(Boolean).join(','))
}
