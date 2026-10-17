import type { Channel, ChannelManager } from './channel-manager.js'

type Config = { enabled: boolean; bot_id: string; secret: string }

export async function syncWecomChannel(
  manager: Pick<ChannelManager, 'has' | 'register' | 'unregister'>,
  previous: Config,
  next: Config,
  create: (config: Config) => Channel,
  onError: (error: unknown) => void,
) {
  if (!next.enabled || !next.bot_id || !next.secret) {
    await manager.unregister('wecom')
    return
  }
  const credentialsChanged = previous.bot_id !== next.bot_id || previous.secret !== next.secret
  if (manager.has('wecom') && credentialsChanged) await manager.unregister('wecom')
  if (!manager.has('wecom')) {
    const channel = create(next)
    manager.register('wecom', channel)
    channel.start().catch(onError)
  }
}
