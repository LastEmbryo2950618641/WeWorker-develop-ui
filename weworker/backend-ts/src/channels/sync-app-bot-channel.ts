import type { Channel, ChannelManager } from './channel-manager.js'

type Config = { enabled: boolean; app_id: string; app_secret: string }

export async function syncAppBotChannel(
  type: 'qq' | 'feishu',
  manager: Pick<ChannelManager, 'has' | 'register' | 'unregister'>,
  previous: Config, next: Config,
  create: (config: Config) => Channel,
  onError: (error: unknown) => void,
) {
  if (!next.enabled || !next.app_id || !next.app_secret) {
    await manager.unregister(type)
    return
  }
  if (manager.has(type) && (previous.app_id !== next.app_id || previous.app_secret !== next.app_secret)) {
    await manager.unregister(type)
  }
  if (!manager.has(type)) {
    const channel = create(next)
    manager.register(type, channel)
    channel.start().catch(onError)
  }
}
