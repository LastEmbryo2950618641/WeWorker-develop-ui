import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../config.js', () => ({
  getSettings: vi.fn(),
}))

import { getSettings } from '../config.js'
import {
  getChannelPermissionMode,
  getOwnerPermissionLevel,
  isChannelOwner,
  normalizeOwnerPermissionLevel,
  normalizeOwnerUserId,
  resolveChannelName,
  validateOwnerUserId,
} from '../channels/channel-permissions.js'

describe('channel permissions', () => {
  beforeEach(() => {
    vi.mocked(getSettings).mockReturnValue({
      channels: {
        qq: { enabled: true, app_id: '', app_secret: '', owner_user_id: 'owner-qq', owner_permission_level: 'full' },
        weixin: { enabled: true, token: '', base_url: '', owner_user_id: '', owner_permission_level: 'full' },
        wecom: { enabled: true, bot_id: '', secret: '', owner_user_id: 'owner-wecom', owner_permission_level: 'no_bash' },
      },
    } as any)
  })

  it('normalizes owner ids', () => {
    expect(normalizeOwnerUserId(' abc ')).toBe('abc')
    expect(normalizeOwnerUserId(null)).toBe('')
  })

  it('normalizes owner permission levels', () => {
    expect(normalizeOwnerPermissionLevel('no_bash')).toBe('no_bash')
    expect(normalizeOwnerPermissionLevel('invalid')).toBe('qa_only')
    expect(normalizeOwnerPermissionLevel(undefined)).toBe('qa_only')
    expect(normalizeOwnerPermissionLevel('full')).toBe('full')
  })

  it('resolves channel names from channel types', () => {
    expect(resolveChannelName('qq_group')).toBe('qq')
    expect(resolveChannelName('weixin')).toBe('weixin')
    expect(resolveChannelName('wecom_group')).toBe('wecom')
  })

  it('grants configured owner permission only to owner', () => {
    expect(isChannelOwner('qq', 'owner-qq')).toBe(true)
    expect(isChannelOwner('qq', 'guest-1')).toBe(false)
    expect(getChannelPermissionMode('qq', 'guest-1')).toBe('qa_only')
    expect(getChannelPermissionMode('qq', 'owner-qq')).toBe('full')
    expect(getChannelPermissionMode('wecom', 'owner-wecom')).toBe('no_bash')
  })

  it('treats all users as qa-only when owner id is not configured', () => {
    expect(getChannelPermissionMode('weixin', 'any-user')).toBe('qa_only')
    expect(isChannelOwner('weixin', 'any-user')).toBe(false)
    expect(getOwnerPermissionLevel('weixin')).toBe('qa_only')
  })

  it('allows owner qa_only level when configured', () => {
    vi.mocked(getSettings).mockReturnValue({
      channels: {
        qq: { enabled: true, app_id: '', app_secret: '', owner_user_id: 'owner-qq', owner_permission_level: 'qa_only' },
        weixin: { enabled: true, token: '', base_url: '', owner_user_id: '', owner_permission_level: 'full' },
        wecom: { enabled: true, bot_id: '', secret: '', owner_user_id: '', owner_permission_level: 'full' },
      },
    } as any)
    expect(getChannelPermissionMode('qq', 'owner-qq')).toBe('qa_only')
  })

  it('validates owner user id format', () => {
    expect(validateOwnerUserId('wecom', '')).toBeNull()
    expect(validateOwnerUserId('wecom', 'err')).toMatch(/过短/)
    expect(validateOwnerUserId('wecom', 'bad id!')).toMatch(/格式不正确/)
    expect(validateOwnerUserId('wecom', 'wohR_KCgAAbIrAnDRuaTZORF5QxppMXA')).toBeNull()
    expect(validateOwnerUserId('qq', 'ABCDEF123456')).toBeNull()
  })
})
