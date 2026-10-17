import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const sockets: FakeSocket[] = []
class FakeSocket extends EventEmitter {
  send = vi.fn()
  close = vi.fn(() => this.emit('close', 1000, Buffer.alloc(0)))
  terminate = vi.fn(() => this.emit('close', 1006, Buffer.alloc(0)))
  constructor() { super(); sockets.push(this); Promise.resolve().then(() => this.emit('open')) }
  frame(data: unknown) { this.emit('message', Buffer.from(JSON.stringify(data))) }
}
vi.mock('ws', () => ({ default: class { constructor() { return new FakeSocket() } } }))
vi.mock('../config.js', () => ({ getSettings: vi.fn() }))
vi.mock('../title-utils.js', () => ({ generateTitle: vi.fn(), generateTitleWithLLM: vi.fn() }))
vi.mock('../works-store.js', () => ({ getLatestChannelNotifyTarget: () => null }))
vi.mock('../channels/channel-manager.js', () => ({ runChannelChat: vi.fn() }))
vi.mock('../channels/channel-permissions.js', () => ({ CHANNEL_MYID_HINT: '', CHANNEL_EMPTY_REPLY_FALLBACK: '', getChannelPermissionModeByType: vi.fn() }))
vi.mock('../logger.js', () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }))
import { QQChannel } from '../channels/qq-channel.js'
let channel: QQChannel
beforeEach(() => {
  vi.useFakeTimers()
  sockets.length = 0
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ access_token: 'fixture-token', expires_in: 7200 }))
  channel = new QQChannel({ app_id: 'fixture-app', app_secret: 'fixture-secret' })
})
afterEach(async () => { await channel.stop(); vi.restoreAllMocks(); vi.useRealTimers() })
const hello = (socket: FakeSocket) => socket.frame({ op: 10, d: { heartbeat_interval: 30_000 } })
const identify = (socket: FakeSocket) => socket.send.mock.calls.map(([raw]) => JSON.parse(raw)).find(frame => frame.op === 2)

it('identifies after Hello with public guild and group/C2C events, not private guild events', async () => {
  await channel.start()
  const socket = sockets[0]
  expect(identify(socket)).toBeUndefined()
  hello(socket)
  expect(identify(socket).d.intents).toBe((1 << 30) | (1 << 12) | (1 << 25))
  socket.frame({ op: 0, t: 'READY', d: { session_id: 'fixture-session', user: {} } })
  expect(channel.getStatus().status).toBe('connected')
})
it('4014 falls back to supported events and reaches READY for QR-created bots', async () => {
  await channel.start()
  hello(sockets[0])
  sockets[0].emit('close', 4014, Buffer.from('disallowed intents'))
  await vi.advanceTimersByTimeAsync(500)
  hello(sockets[1])
  expect(identify(sockets[1]).d.intents).toBe((1 << 9) | (1 << 12) | (1 << 25))
  sockets[1].emit('close', 4014, Buffer.from('disallowed intents'))
  await vi.advanceTimersByTimeAsync(500)
  hello(sockets[2])
  expect(identify(sockets[2]).d.intents).toBe(1 << 25)
  sockets[2].frame({ op: 0, t: 'READY', d: { session_id: 'fixture-session', user: {} } })
  expect(channel.getStatus().status).toBe('connected')
  sockets[0].frame({ op: 9 })
  expect(channel.getStatus().status).toBe('connected')
})
it('exhausted 4014 subscriptions produce an actionable error instead of an endless retry', async () => {
  await channel.start()
  for (let i = 0; i < 3; i++) {
    hello(sockets[i]); sockets[i].emit('close', 4014, Buffer.alloc(0))
    await vi.advanceTimersByTimeAsync(500)
  }
  expect(channel.getStatus()).toEqual({ status: 'error', error: expect.stringContaining('事件订阅权限不足') })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(sockets).toHaveLength(3)
})
it('stop cancels retries and heartbeat timers', async () => {
  await channel.start(); hello(sockets[0])
  sockets[0].emit('close', 4014, Buffer.alloc(0))
  await channel.stop()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(sockets).toHaveLength(1)
  expect(vi.getTimerCount()).toBe(0)
})
it('missing READY times out and reports a connection error', async () => {
  await channel.start(); hello(sockets[0])
  await vi.advanceTimersByTimeAsync(15_000)
  expect(sockets[0].terminate).toHaveBeenCalledOnce()
  expect(channel.getStatus().status).toBe('error')
})
it('authentication rejection is surfaced without retrying unchanged credentials', async () => {
  await channel.start(); hello(sockets[0])
  sockets[0].emit('close', 4004, Buffer.alloc(0))
  expect(channel.getStatus()).toEqual({ status: 'error', error: expect.stringContaining('鉴权失败') })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(sockets).toHaveLength(1)
})
it('reconnects after an unexpected disconnect and clears the READY deadline on success', async () => {
  await channel.start(); hello(sockets[0])
  sockets[0].frame({ op: 0, t: 'READY', d: { session_id: 'fixture-session', user: {} } })
  await vi.advanceTimersByTimeAsync(15_000)
  expect(sockets[0].terminate).not.toHaveBeenCalled()
  sockets[0].emit('close', 1006, Buffer.alloc(0))
  expect(channel.getStatus().status).toBe('error')
  await vi.advanceTimersByTimeAsync(5000)
  hello(sockets[1])
  sockets[1].frame({ op: 0, t: 'READY', d: { session_id: 'fixture-new-session', user: {} } })
  expect(channel.getStatus().status).toBe('connected')
})
it('does not open a socket if QQ returns no access token', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ code: 400, message: 'fixture-error' }))
  await channel.start()
  expect(sockets).toHaveLength(0)
  expect(channel.getStatus()).toEqual({ status: 'error', error: expect.stringContaining('鉴权失败') })
})
