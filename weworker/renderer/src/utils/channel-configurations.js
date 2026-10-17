export const CHANNEL_TYPES = [
  { id: 'qq', name: 'QQ' },
  { id: 'feishu', name: '飞书' },
  { id: 'wecom', name: '企业微信' },
  { id: 'weixin', name: '微信' },
]

// Include disabled legacy configurations and masked credentials as well.
export function configuredChannelIds(channels = {}) {
  return CHANNEL_TYPES.filter(({ id }) => {
    const channel = channels[id] || {}
    return channel.enabled || channel.has_app_secret || channel.has_secret || channel.has_token
      || ['app_id', 'bot_id', 'owner_user_id'].some(key => String(channel[key] || '').trim())
  }).map(({ id }) => id)
}
