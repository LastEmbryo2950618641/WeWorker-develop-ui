import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ ws: vi.fn() }))
vi.mock('ws', () => ({ default: mocks.ws }))
vi.mock('../config.js', () => ({ getSettings: vi.fn() }))
vi.mock('../title-utils.js', () => ({ generateTitle: vi.fn(), generateTitleWithLLM: vi.fn() }))
vi.mock('../works-store.js', () => ({ getLatestChannelNotifyTarget: () => null }))
vi.mock('../channels/channel-manager.js', () => ({ runChannelChat: vi.fn() }))
vi.mock('../channels/channel-permissions.js', () => ({ CHANNEL_MYID_HINT: '', CHANNEL_EMPTY_REPLY_FALLBACK: '', getChannelPermissionModeByType: vi.fn() }))
vi.mock('../logger.js', () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn() }) }))
import { QQChannel } from '../channels/qq-channel.js'

it('stopping while the QQ token request is pending prevents an old bot reconnecting', async () => {
  let release!: (value: Response) => void
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { release = resolve }))
  try {
    const channel = new QQChannel({ app_id: 'fixture-app', app_secret: 'fixture-secret' })
    const starting = channel.start()
    await channel.stop()
    release(Response.json({ access_token: 'fixture-token', expires_in: 7200 }))
    await starting
    expect(mocks.ws).not.toHaveBeenCalled()
    // A previously scheduled reconnect must return before fetching another token.
    await (channel as unknown as { _connect(): Promise<void> })._connect()
    expect(request).toHaveBeenCalledOnce()
  } finally { request.mockRestore() }
})
