import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let root: string
afterEach(() => { vi.doUnmock('node:os'); vi.resetModules(); if (root) fs.rmSync(root, { recursive: true, force: true }) })

it('uses package enablement for welcome visibility without reviving disabled packages or changing legacy behavior', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-site-visibility-'))
  vi.resetModules()
  vi.doMock('node:os', () => ({ default: { ...os, homedir: () => root }, ...os, homedir: () => root }))
  const config = await import('../config.js')
  config.updateSettings({ site_toggles: { managed: false, legacy: false, disabled: true } })
  config.setSiteVisibility('managed', true, true)
  config.setSiteVisibility('legacy', true)
  config.setSiteVisibility('disabled', false, false)
  expect(config.getSettings().site_toggles).toMatchObject({ managed: true, legacy: false, disabled: true })
  config.setAllEnabledSitesWelcomeVisibility(['managed', 'legacy', 'disabled'], false, new Map([['managed', true], ['disabled', false]]))
  expect(config.getSettings().site_toggles).toMatchObject({ managed: 'hidden', legacy: false, disabled: true })
  expect(config.getSiteEnabled('disabled', true, false)).toBe(false)
})
