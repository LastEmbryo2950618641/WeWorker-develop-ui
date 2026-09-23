// Feature: user adapters coexist with builtin adapters (adapter hub)
// **Validates: resolveUserAdaptersDir, install id suffix logic**

import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'

// Mock os + fs before importing paths
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, homedir: vi.fn(() => 'C:/Users/mock') }
})
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, existsSync: vi.fn(() => false) }
})

import { existsSync } from 'fs'
import { resolveUserAdaptersDir, resolveAdaptersDir } from '../paths.js'

// Normalize backslashes so path matching is platform-independent
const norm = (p) => String(p).replace(/\\/g, '/')

/**
 * Replicate the resolveInstallId logic from adapter-cli.js.
 * - 与内置同名：加 `.user` 后缀共存
 * - 其余：原 id
 */
async function resolveInstallId(adapterId) {
  const builtinManifest = join(resolveAdaptersDir(), adapterId, 'manifest.json')
  if (existsSync(builtinManifest)) {
    return `${adapterId}.user`
  }
  return adapterId
}

describe('resolveUserAdaptersDir', () => {
  it('defaults to ~/.weworker/adapters when no existing dir', () => {
    expect(norm(resolveUserAdaptersDir())).toBe('C:/Users/mock/.weworker/adapters')
  })

  it('prefers ~/.weworker/adapters when it exists', () => {
    vi.mocked(existsSync).mockImplementation((p) => norm(p).includes('.weworker/adapters'))
    expect(norm(resolveUserAdaptersDir())).toBe('C:/Users/mock/.weworker/adapters')
  })

  it('keeps the stable write root when only the legacy directory exists', () => {
    vi.mocked(existsSync).mockImplementation((p) => norm(p).includes('.webcli/adapters'))
    expect(norm(resolveUserAdaptersDir())).toBe('C:/Users/mock/.weworker/adapters')
  })

  it('uses weworker path as default even when neither exists', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    expect(norm(resolveUserAdaptersDir())).toBe('C:/Users/mock/.weworker/adapters')
  })
})

describe('install id suffix (user/builtin coexistence)', () => {
  it('adds .user suffix when id collides with a builtin adapter', async () => {
    vi.mocked(existsSync).mockImplementation((p) => norm(p).includes('adapters/mail.qq.com/manifest.json'))
    expect(await resolveInstallId('mail.qq.com')).toBe('mail.qq.com.user')
  })

  it('keeps plain id when no builtin collision', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    expect(await resolveInstallId('test.site')).toBe('test.site')
  })

  it('adds .user suffix for jd.com (a real builtin)', async () => {
    vi.mocked(existsSync).mockImplementation((p) => norm(p).includes('adapters/jd.com/manifest.json'))
    expect(await resolveInstallId('jd.com')).toBe('jd.com.user')
  })
})
