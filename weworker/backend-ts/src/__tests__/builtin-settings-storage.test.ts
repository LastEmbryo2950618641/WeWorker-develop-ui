import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules() })

it('keeps deployment keys out of settings during activation, unrelated saves and reload', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weworker-builtin-fixture-'))
  vi.spyOn(os, 'homedir').mockReturnValue(root)
  vi.stubEnv('WEWORKER_BUILTIN_API_KEY', 'fixture-runtime-only-key')
  vi.resetModules()
  const config = await import('../config.js')
  const { activateBuiltinProvider, BUILTIN_PROVIDER } = await import('../builtin-provider.js')
  expect(config.updateSettings(activateBuiltinProvider(BUILTIN_PROVIDER)).api_key).toBe('fixture-runtime-only-key')
  expect(config.updateSettings({ welcome_featured_site_limit: 12 }).api_key).toBe('fixture-runtime-only-key')
  const saved = fs.readFileSync(path.join(root, '.weworker', 'settings.json'), 'utf8')
  expect(saved).not.toContain('fixture-runtime-only-key')
  expect(JSON.parse(saved).active_provider).toBe('builtin')
  config.resetSettingsStateForTests()
  expect(config.getSettings().api_key).toBe('fixture-runtime-only-key')
  vi.stubEnv('WEWORKER_BUILTIN_API_KEY', '')
  expect(config.getSettings().api_key).not.toBe('')
  expect(JSON.parse(fs.readFileSync(path.join(root, '.weworker', 'settings.json'), 'utf8')).api_key).toBe('')
  expect(config.updateSettings({ active_provider: 'anthropic', api_key: '' }).api_key).toBe('')
})

it('starts a fresh settings file in onboarding and persists completion', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weworker-onboarding-fixture-'))
  vi.spyOn(os, 'homedir').mockReturnValue(root)
  vi.resetModules()
  const config = await import('../config.js')
  expect(config.getSettings().onboarding_completed).toBe(false)
  config.updateSettings({ onboarding_completed: true })
  config.resetSettingsStateForTests()
  expect(config.getSettings().onboarding_completed).toBe(true)
})
