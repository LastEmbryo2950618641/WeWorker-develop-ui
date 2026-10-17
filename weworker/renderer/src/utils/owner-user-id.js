// Keep in sync with backend-ts/src/channels/channel-permissions.ts validateOwnerUserId

const CHANNEL_LABELS = {
  qq: 'QQ',
  weixin: '微信',
  wecom: '企业微信',
  feishu: '飞书',
}

const OWNER_USER_ID_MIN_LENGTH = 6
const OWNER_USER_ID_MAX_LENGTH = 128
const OWNER_USER_ID_PATTERN = /^[A-Za-z0-9_-]+$/

export function normalizeOwnerUserId(value) {
  return String(value ?? '').trim()
}

export function getOwnerPermissionSelection(ownerId, permission) {
  if (!normalizeOwnerUserId(ownerId)) return 'qa_only'
  return ['qa_only', 'no_bash', 'full'].includes(permission) ? permission : 'qa_only'
}

export function hasUnsavedOwnerPermission(ownerId, permission, saved = {}) {
  return normalizeOwnerUserId(ownerId) !== normalizeOwnerUserId(saved.owner_user_id)
    || getOwnerPermissionSelection(ownerId, permission) !== getOwnerPermissionSelection(saved.owner_user_id, saved.owner_permission_level)
}

export function validateOwnerUserId(channel, value) {
  const id = normalizeOwnerUserId(value)
  if (!id) return null

  const label = CHANNEL_LABELS[channel] || channel
  if (id.length < OWNER_USER_ID_MIN_LENGTH) {
    return `${label} 主人 ID 过短，请在该通道发送 /myid 获取完整 ID 后粘贴（至少 ${OWNER_USER_ID_MIN_LENGTH} 个字符）`
  }
  if (id.length > OWNER_USER_ID_MAX_LENGTH) {
    return `${label} 主人 ID 过长（最多 ${OWNER_USER_ID_MAX_LENGTH} 个字符）`
  }
  if (!OWNER_USER_ID_PATTERN.test(id)) {
    return `${label} 主人 ID 格式不正确，请发送 /myid 获取后原样粘贴（仅允许字母、数字、下划线、连字符）`
  }
  return null
}
