import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.restoreAllMocks(); vi.resetModules() })

it('defaults to QA, normalizes ownerless legacy defaults and preserves explicit owner grants across reload', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weworker-permissions-fixture-'))
  vi.spyOn(os, 'homedir').mockReturnValue(root)
  vi.resetModules()
  const config = await import('../config.js')
  const initial = config.getSettings()
  for (const channel of Object.values(initial.channels)) expect(channel.owner_permission_level).toBe('qa_only')
  const channels = structuredClone(initial.channels)
  channels.wecom.owner_permission_level = 'full'
  channels.qq.owner_user_id = 'fixture-owner'
  channels.qq.owner_permission_level = 'full'
  channels.feishu.owner_user_id = 'fixture-owner'
  channels.feishu.owner_permission_level = 'no_bash'
  config.updateSettings({ channels })
  config.resetSettingsStateForTests()
  const reloaded = config.getSettings().channels
  expect(reloaded.wecom.owner_permission_level).toBe('qa_only')
  expect(reloaded.qq.owner_permission_level).toBe('full')
  expect(reloaded.feishu.owner_permission_level).toBe('no_bash')
})
