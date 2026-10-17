import type { Channel, ChannelManager } from './channel-manager.js'

type Config = { enabled: boolean; token: string; base_url: string }

// Empty password fields preserve the saved credential; never return it to the UI.
export function resolveWeixinToken(value: unknown, saved: string): string {
  if (value === undefined) return saved
  if (typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error('微信 Token 格式无效')
  return value.trim() || saved
}

export async function syncWeixinChannel(
  manager: Pick<ChannelManager, 'has' | 'register' | 'unregister'>,
  previous: Config,
  next: Config,
  create: (config: Config) => Channel,
  onError: (error: unknown) => void,
) {
  if (!next.enabled || !next.token) {
    await manager.unregister('weixin')
    return
  }
  if (manager.has('weixin') && (previous.token !== next.token || previous.base_url !== next.base_url)) {
    await manager.unregister('weixin')
  }
  if (!manager.has('weixin')) {
    const channel = create(next)
    manager.register('weixin', channel)
    channel.start().catch(onError)
  }
}
