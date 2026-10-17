import { describe, expect, it } from 'vitest'
import { hasLegacyProviderConfig, isProviderVisible, normalizeAddedProviders } from '../provider-visibility.js'

describe('provider visibility', () => {
  it('shows fixed presets without credentials or explicit additions', () => {
    for (const id of ['anthropic', 'glm', 'deepseek']) {
      expect(isProviderVisible(id, { addedProviders: [], activeProvider: '', legacy: {} })).toBe(true)
    }
    expect(isProviderVisible('custom', { addedProviders: [], activeProvider: '', legacy: {} })).toBe(false)
  })
  it('retains providers explicitly added by the user', () => {
    expect(normalizeAddedProviders(['deepseek', 'deepseek', 'unknown', 'custom'])).toEqual(['deepseek', 'custom'])
    expect(isProviderVisible('deepseek', {
      addedProviders: ['deepseek'],
      activeProvider: 'anthropic',
      legacy: {},
    })).toBe(true)
  })

  it('retains historical custom OpenAI configuration after an upgrade', () => {
    expect(hasLegacyProviderConfig({
      hasKey: false,
      model: '',
      baseUrl: '',
      openaiBaseUrl: 'https://gateway.example/v1',
    })).toBe(true)
    expect(isProviderVisible('custom', {
      addedProviders: [],
      activeProvider: 'anthropic',
      legacy: {
        custom: {
          hasKey: false,
          model: '',
          openaiBaseUrl: 'https://gateway.example/v1',
        },
      },
    })).toBe(true)
  })

  it('shows fixed presets but hides providers outside the registered profile', () => {
    expect(isProviderVisible('deepseek', {
      addedProviders: [], activeProvider: 'anthropic',
      legacy: { deepseek: { hasKey: false, model: 'deepseek-v4-flash', defaultModels: ['deepseek-v4-flash'] } },
    })).toBe(true)
    expect(isProviderVisible('unregistered', {
      addedProviders: ['unregistered'], activeProvider: 'unregistered',
      legacy: { unregistered: { hasKey: true, model: 'fixture-model' } },
    })).toBe(false)
    expect(normalizeAddedProviders(['unregistered', 'anthropic'])).toEqual(['anthropic'])
  })

  it('shows the fixed active provider before its first save', () => {
    expect(isProviderVisible('anthropic', {
      addedProviders: [], activeProvider: 'anthropic',
      legacy: { anthropic: { hasKey: false, model: 'default-model', defaultModels: ['default-model'] } },
    })).toBe(true)
  })

  it('retains active and inactive legacy credentials, selected models and explicit empty additions', () => {
    for (const activeProvider of ['anthropic', 'deepseek']) {
      expect(isProviderVisible('anthropic', {
        addedProviders: [], activeProvider,
        legacy: { anthropic: { hasKey: true, model: 'default-model', defaultModels: ['default-model'] } },
      })).toBe(true)
      expect(isProviderVisible('anthropic', {
        addedProviders: [], activeProvider,
        legacy: { anthropic: { hasKey: false, model: 'saved-model', defaultModels: ['default-model'] } },
      })).toBe(true)
      expect(isProviderVisible('anthropic', {
        addedProviders: ['anthropic'], activeProvider, legacy: {},
      })).toBe(true)
    }
  })
})
