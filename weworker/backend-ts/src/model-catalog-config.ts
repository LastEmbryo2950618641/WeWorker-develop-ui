import { normalizeLlmUrlInput } from './llm-egress.js'

export type ModelCatalogAuthType = 'inherit' | 'auth_token' | 'api_key'
export interface ModelCatalogConfig {
  models_url?: string
  models_url_is_full?: boolean
  models_auth_type?: ModelCatalogAuthType
  openai_models_url?: string
  openai_models_url_is_full?: boolean
}

export function resolveModelCatalogEndpoint(raw: string, fullUrl = true): string {
  const url = normalizeLlmUrlInput(raw, fullUrl)
  if (fullUrl || /\/models$/i.test(url)) return url
  return /\/v\d+$/i.test(url) ? `${url}/models` : `${url}/v1/models`
}

export function modelCatalogConfigPatch(input: Record<string, unknown>, saved: ModelCatalogConfig = {}): ModelCatalogConfig {
  const patch: ModelCatalogConfig = {}
  for (const field of ['models_url', 'openai_models_url'] as const) {
    const mode = field === 'models_url' ? 'models_url_is_full' : 'openai_models_url_is_full'
    if (input[mode] !== undefined) {
      if (typeof input[mode] !== 'boolean') throw new Error('使用完整 URL 必须为布尔值')
      patch[mode] = input[mode]
    }
    // Before this option existed every explicit catalog URL was a full URL.
    const fullUrl = patch[mode] ?? saved[mode] ?? true
    if (input[field] !== undefined) {
      if (typeof input[field] !== 'string') throw new Error('模型列表地址必须为字符串')
      patch[field] = input[field].trim() ? normalizeLlmUrlInput(input[field], fullUrl) : ''
    } else if (input[mode] !== undefined && saved[field]) {
      normalizeLlmUrlInput(saved[field], fullUrl)
    }
  }
  if (input.models_auth_type !== undefined) {
    if (!['inherit', 'auth_token', 'api_key'].includes(String(input.models_auth_type))) throw new Error('模型列表认证方式无效')
    patch.models_auth_type = input.models_auth_type as ModelCatalogAuthType
  }
  return patch
}

// An explicit empty value clears a saved override; absent fields preserve it.
export function resolveModelCatalogConfig(input: Record<string, unknown>, saved: ModelCatalogConfig) {
  return modelCatalogConfigPatch({ ...saved, ...Object.fromEntries(
    ['models_url', 'models_url_is_full', 'models_auth_type', 'openai_models_url', 'openai_models_url_is_full'].filter(key => input[key] !== undefined).map(key => [key, input[key]]),
  ) })
}
