import { timingSafeEqual } from 'node:crypto'
import type { Settings } from './config.js'
import { assertAllowedLlmBaseUrl, normalizeLlmBaseUrl } from './llm-egress.js'
import { buildRuntimeAllowedLlmBaseUrls, getProvider, PROVIDERS } from './provider-registry.js'

export function isAuthorizedModelConfigRequest(authorization: string | undefined, expectedToken: string): boolean {
  const actual = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!actual || !expectedToken) return false
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expectedToken)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

export function resolveWebwrightModelConfig(settings: Settings) {
  const provider = getProvider(settings.active_provider)
  const independent = Boolean(settings.exploration_base_url)
  const apiKey = independent && settings.exploration_use_main_key === false ? settings.exploration_api_key : settings.api_key
  const model = independent && settings.exploration_model ? settings.exploration_model : settings.model
  if (!provider || !apiKey || !model) throw new Error('请先配置 API Key 和模型')
  const mapped = settings.active_provider === 'custom' && settings.base_url_custom
    ? PROVIDERS.find(item => item.id !== 'custom' && normalizeLlmBaseUrl(item.weworker.baseUrl) === normalizeLlmBaseUrl(settings.base_url_custom))
    : undefined
  const configuredProvider = independent ? PROVIDERS.find(item => item.id !== 'custom'
    && normalizeLlmBaseUrl(item.webwright.baseUrl) === normalizeLlmBaseUrl(settings.exploration_base_url)) : undefined
  const config = independent ? configuredProvider?.webwright || {
    protocol: 'openai_chat_completions' as const,
    modelClass: 'openai_chat' as const,
    structuredOutput: 'openai_json_object' as const,
  } : settings.active_provider === 'custom' && !settings.openai_base_url_custom && mapped ? mapped.webwright : provider.webwright
  const baseUrl = settings.exploration_base_url || (settings.active_provider === 'custom'
    ? settings.openai_base_url_custom || mapped?.webwright.baseUrl || settings.base_url_custom
    : provider.webwright.baseUrl)
  if (!baseUrl) throw new Error('请填写网站探索服务地址（OpenAI Chat Completions 兼容接口）')
  return {
    provider_id: independent ? 'custom' : settings.active_provider,
    protocol: config.protocol,
    model_class: config.modelClass,
    base_url: assertAllowedLlmBaseUrl(
      baseUrl,
      buildRuntimeAllowedLlmBaseUrls(settings.base_url_custom, settings.openai_base_url_custom, settings.exploration_base_url),
    ),
    model,
    api_key: apiKey,
    structured_output: config.structuredOutput,
  }
}

// Activating a preset provider returns the exploration agent to that provider's preset webwright config.
export function explorationResetPatch(provider: string): Partial<Pick<Settings, 'exploration_base_url' | 'exploration_model' | 'exploration_api_key' | 'exploration_use_main_key'>> {
  if (provider === 'custom') return {}
  return { exploration_base_url: '', exploration_model: '', exploration_api_key: '', exploration_use_main_key: true }
}

export function suggestExplorationBaseUrl(settings: Settings): { url: string; generated: boolean } {
  const saved = settings.exploration_base_url || (settings.active_provider === 'custom' ? settings.openai_base_url_custom : '')
  if (saved) return { url: normalizeLlmBaseUrl(saved), generated: false }
  const provider = getProvider(settings.active_provider)
  if (provider && provider.id !== 'custom') return { url: provider.webwright.baseUrl, generated: false }
  if (!settings.base_url_custom) return { url: '', generated: false }
  const mainUrl = normalizeLlmBaseUrl(settings.base_url_custom)
  const mapped = PROVIDERS.find(item => item.id !== 'custom' && normalizeLlmBaseUrl(item.weworker.baseUrl) === mainUrl)
  if (mapped) return { url: mapped.webwright.baseUrl, generated: false }
  return { url: mainUrl.endsWith('/v1') ? mainUrl : `${mainUrl}/v1`, generated: true }
}
