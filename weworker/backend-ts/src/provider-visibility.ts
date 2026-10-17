import { PROVIDERS, getProvider } from './provider-registry.js'
import type { Settings } from './config.js'

// Provider visibility / "added" state for the model picker.
// The three fixed presets are always visible. Custom legacy configurations stay
// visible when explicitly added or previously configured.

export function isFixedProvider(id: string): boolean {
  return ['anthropic', 'glm', 'deepseek'].includes(id) && !!getProvider(id)
}

// Preset provider ids offered in the "add provider" dialog.
export const PRESET_PROVIDER_IDS = PROVIDERS.filter(provider => provider.id !== 'custom').map(provider => provider.id)
export const CUSTOM_PROVIDER_ID = 'custom'
export const ADDABLE_PROVIDER_IDS = PROVIDERS.map(provider => provider.id)

export interface ProviderLegacyConfig {
  hasKey: boolean
  model: string
  // Non-empty model values shipped as defaults by older versions; these alone
  // do not prove the user ever configured the provider.
  defaultModels?: string[]
  baseUrl?: string
  openaiBaseUrl?: string
}

export function normalizeAddedProviders(
  raw: unknown,
  allowedIds: Iterable<string> = ADDABLE_PROVIDER_IDS,
): string[] {
  if (!Array.isArray(raw)) return []
  const allowed = new Set(allowedIds)
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of raw) {
    const id = typeof value === 'string' ? value.trim() : ''
    if (!id || !allowed.has(id) || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

export function hasLegacyProviderConfig(config: ProviderLegacyConfig): boolean {
  if (config.hasKey) return true
  const model = (config.model || '').trim()
  if (model && !(config.defaultModels || []).includes(model)) return true
  if ((config.baseUrl || '').trim() || (config.openaiBaseUrl || '').trim()) return true
  return false
}

export interface ProviderVisibilityInput {
  addedProviders: Iterable<string>
  activeProvider: string
  legacy: Record<string, ProviderLegacyConfig | undefined>
}

export function isProviderVisible(id: string, input: ProviderVisibilityInput): boolean {
  if (!getProvider(id)) return false
  if (isFixedProvider(id)) return true
  for (const added of input.addedProviders) {
    if (added === id) return true
  }
  const legacy = input.legacy[id]
  return legacy ? hasLegacyProviderConfig(legacy) : false
}

export function buildProviderVisibility(s: Settings) {
  const legacy: Record<string, ProviderLegacyConfig> = {
    anthropic: { hasKey: !!s.api_key_anthropic, model: s.model_anthropic, defaultModels: [getProvider('anthropic')?.defaultModel ?? ''] },
    glm: { hasKey: !!s.api_key_glm, model: s.model_glm, defaultModels: [getProvider('glm')?.defaultModel ?? ''] },
    deepseek: { hasKey: !!s.api_key_deepseek, model: s.model_deepseek, defaultModels: [getProvider('deepseek')?.defaultModel ?? ''] },
    custom: { hasKey: !!s.api_key_custom, model: s.model_custom, baseUrl: s.base_url_custom, openaiBaseUrl: s.openai_base_url_custom },
  }
  return (id: string) => isProviderVisible(id, {
    addedProviders: s.added_providers || [],
    activeProvider: s.active_model_configuration ? '' : s.active_provider,
    legacy,
  })
}
