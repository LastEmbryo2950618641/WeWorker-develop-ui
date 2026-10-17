import { afterEach, expect, it, vi } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { once } from 'node:events'
import { probeChannel, resolveChannelProbeConfig, probeWecomSubscription, probeExistingWecomSocket, ProbeError } from '../channels/channel-probe.js'

const credentials = { app_id: 'fixture-app', app_secret: 'fixture-secret' }
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
afterEach(() => vi.useRealTimers())
it('preserves saved masked credentials and ignores unrelated fields without mutating settings', () => {
  expect(resolveChannelProbeConfig('qq', { app_id: ' fixture-new ', app_secret: '', enabled: true }, credentials)).toEqual({ ...credentials, app_id: 'fixture-new' })
  expect(credentials.app_id).toBe('fixture-app')
})
it.each(['qq', 'feishu', 'weixin', 'wecom'] as const)('rejects missing credentials for %s without network calls', async channel => {
  const request = vi.fn()
  const result = await probeChannel(channel, {}, {}, { request })
  expect(result.ok).toBe(false)
  expect(result.checks[0].status).toBe('failure')
  expect(request).not.toHaveBeenCalled()
})
it('rejects unlisted WeChat URLs before sending credentials', async () => {
  const request = vi.fn()
  expect((await probeChannel('weixin', { token: 'fixture-token', base_url: 'https://example.com' }, {}, { request })).ok).toBe(false)
  expect(request).not.toHaveBeenCalled()
})
it('validates QQ credentials and gateway without opening a message connection', async () => {
  const request = vi.fn().mockResolvedValueOnce(reply({ access_token: 'fixture-access-token' })).mockResolvedValueOnce(reply({ url: 'wss://example.com' }))
  const result = await probeChannel('qq', credentials, {}, { request })
  expect(result.ok).toBe(true)
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls[1][1].headers.Authorization).toBe('QQBot fixture-access-token')
  expect(JSON.stringify(result)).not.toContain('fixture-access-token')
})
it('checks Feishu bot capability after authentication', async () => {
  const request = vi.fn().mockResolvedValueOnce(reply({ code: 0, tenant_access_token: 'fixture-access-token' })).mockResolvedValueOnce(reply({ code: 0, bot: { open_id: 'fixture-bot' } }))
  expect((await probeChannel('feishu', credentials, {}, { request })).ok).toBe(true)
  expect(request.mock.calls[1][0]).toContain('/bot/v3/info')
})
it('does not treat HTTP 200 authentication errors as successful', async () => {
  const request = vi.fn().mockResolvedValue(reply({ code: 999, msg: 'fixture-private-response' }))
  const result = await probeChannel('feishu', credentials, {}, { request })
  expect(result.ok).toBe(false)
  expect(JSON.stringify(result)).not.toContain('fixture-private-response')
})
it('does not expose raw network errors or response bodies', async () => {
  for (const request of [vi.fn().mockRejectedValue(new Error('fixture-private-token')), vi.fn().mockResolvedValue(reply('fixture-private-token', 401))]) {
    const result = await probeChannel('qq', credentials, {}, { request })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('fixture-private-token')
  }
})
it('checks WeChat getconfig without reading updates or sending messages', async () => {
  const request = vi.fn().mockResolvedValue(reply({ ret: 0 }))
  const result = await probeChannel('weixin', { token: 'fixture-token' }, {}, { request, weixinUser: { id: 'fixture-user' } })
  expect(result.ok).toBe(true)
  expect(request.mock.calls[0][0]).toBe('https://ilinkai.weixin.qq.com/ilink/bot/getconfig')
  expect(request).toHaveBeenCalledOnce()
})
it('keeps WeChat unverified without a previous user rather than claiming success', async () => {
  const request = vi.fn()
  const result = await probeChannel('weixin', { token: 'fixture-token' }, {}, { request })
  expect(result.ok).toBe(false)
  expect(result.checks[1].status).toBe('skipped')
  expect(request).not.toHaveBeenCalled()
})
it.each([{ ret: -14 }, {}, { ret: 0, errcode: 1 }])('rejects expired or ambiguous WeChat responses: %j', async body => {
  expect((await probeChannel('weixin', { token: 'fixture-token' }, {}, { request: vi.fn().mockResolvedValue(reply(body)), weixinUser: { id: 'fixture-user' } })).ok).toBe(false)
})
it('reuses the active WeCom connection and propagates actionable configuration errors', async () => {
  const subscribeWecom = vi.fn()
  const probeConnection = vi.fn().mockResolvedValue(undefined)
  const config = { bot_id: 'fixture-bot', secret: 'fixture-secret' }
  expect((await probeChannel('wecom', config, {}, { activeWecom: { probeConnection }, subscribeWecom })).ok).toBe(true)
  expect(subscribeWecom).not.toHaveBeenCalled()
  probeConnection.mockRejectedValue(new ProbeError('请先保存再检测'))
  const result = await probeChannel('wecom', config, {}, { activeWecom: { probeConnection }, subscribeWecom })
  expect(result.ok).toBe(false)
  expect(result.checks[1].message).toBe('请先保存再检测')
})
it('bounds HTTP requests with an abort signal and forbids redirects', async () => {
  const request = vi.fn().mockResolvedValue(reply({}))
  await probeChannel('qq', credentials, {}, { request })
  expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  expect(request.mock.calls[0][1].redirect).toBe('error')
})

async function fixtureServer(handler: (socket: WebSocket) => void) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(server, 'listening')
  server.on('connection', handler)
  const address = server.address() as { port: number }
  return { url: `ws://127.0.0.1:${address.port}`, close: async () => {
    for (const client of server.clients) client.terminate()
    await new Promise<void>(resolve => server.close(() => resolve()))
  } }
}
it.each([0, 1])('temporary WeCom subscription checks acknowledgement and closes (code %s)', async code => {
  const fixture = await fixtureServer(socket => socket.on('message', raw => {
    const data = JSON.parse(raw.toString())
    expect(data.cmd).toBe('aibot_subscribe')
    socket.send(JSON.stringify({ headers: { req_id: 'unrelated' }, errcode: 0 }))
    socket.send(JSON.stringify({ headers: data.headers, errcode: code }))
  }))
  try {
    const promise = probeWecomSubscription('fixture-bot', 'fixture-secret', fixture.url)
    if (code === 0) await expect(promise).resolves.toBeUndefined()
    else await expect(promise).rejects.toThrow('认证失败')
  } finally { await fixture.close() }
})
it('temporary WeCom connection times out and does not remain open', async () => {
  const fixture = await fixtureServer(() => {})
  try { await expect(probeWecomSubscription('fixture-bot', 'fixture-secret', fixture.url, 30)).rejects.toThrow('超时') }
  finally { await fixture.close() }
})
it('existing WeCom heartbeat leaves the socket open and removes its listeners', async () => {
  const fixture = await fixtureServer(socket => socket.on('message', raw => {
    const data = JSON.parse(raw.toString())
    expect(data.cmd).toBe('ping')
    socket.send(JSON.stringify({ headers: data.headers, errcode: 0 }))
  }))
  const socket = new WebSocket(fixture.url)
  await once(socket, 'open')
  try {
    await probeExistingWecomSocket(socket)
    expect(socket.readyState).toBe(WebSocket.OPEN)
    expect(socket.listenerCount('message')).toBe(0)
    expect(socket.listenerCount('close')).toBe(0)
  } finally { socket.terminate(); await fixture.close() }
})
it('existing WeCom timeout removes listeners without closing the live connection', async () => {
  const fixture = await fixtureServer(() => {})
  const socket = new WebSocket(fixture.url)
  await once(socket, 'open')
  try {
    await expect(probeExistingWecomSocket(socket, 30)).rejects.toThrow('超时')
    expect(socket.readyState).toBe(WebSocket.OPEN)
    expect(socket.listenerCount('message')).toBe(0)
  } finally { socket.terminate(); await fixture.close() }
})
