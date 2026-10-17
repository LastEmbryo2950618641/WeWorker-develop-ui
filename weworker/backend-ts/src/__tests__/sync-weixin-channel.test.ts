import { expect, it, vi } from 'vitest'
import { resolveWeixinToken, syncWeixinChannel } from '../channels/sync-weixin-channel.js'

const config = { enabled: true, token: 'fixture-token', base_url: 'https://example.com' }
function setup(registered = false) {
  let exists = registered
  const manager = {
    has: () => exists,
    register: vi.fn(() => { exists = true }),
    unregister: vi.fn(async () => { exists = false }),
  }
  const channel = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), getStatus: () => ({ status: 'starting' as const }) }
  return { manager, channel, create: vi.fn(() => channel), onError: vi.fn() }
}
it('accepts manual tokens and preserves saved credentials when blank or omitted', () => {
  expect(resolveWeixinToken(' fixture-new-token ', config.token)).toBe('fixture-new-token')
  for (const value of [undefined, '', '  ']) expect(resolveWeixinToken(value, config.token)).toBe(config.token)
  expect(resolveWeixinToken('', '')).toBe('')
})
it.each([null, 42, {}, 'fixture\r\nheader'])('rejects malformed tokens without echoing their content', value => {
  expect(() => resolveWeixinToken(value, config.token)).toThrow('微信 Token 格式无效')
})
it('starts a manually configured connection', async () => {
  const t = setup()
  await syncWeixinChannel(t.manager, { ...config, token: '' }, config, t.create, t.onError)
  expect(t.create).toHaveBeenCalledWith(config)
  expect(t.channel.start).toHaveBeenCalledOnce()
})
it.each([{ token: 'fixture-replacement-token' }, { base_url: 'https://example.org' }])('reconnects after configuration changes: %j', async change => {
  const t = setup(true)
  await syncWeixinChannel(t.manager, config, { ...config, ...change }, t.create, t.onError)
  expect(t.manager.unregister).toHaveBeenCalledWith('weixin')
  expect(t.manager.unregister.mock.invocationCallOrder[0]).toBeLessThan(t.manager.register.mock.invocationCallOrder[0])
  expect(t.channel.start).toHaveBeenCalledOnce()
})
it('leaves unchanged connections running', async () => {
  const t = setup(true)
  await syncWeixinChannel(t.manager, config, config, t.create, t.onError)
  expect(t.manager.unregister).not.toHaveBeenCalled()
  expect(t.create).not.toHaveBeenCalled()
})
it.each([{ enabled: false }, { token: '' }])('stops disabled or incomplete connections: %j', async change => {
  const t = setup(true)
  await syncWeixinChannel(t.manager, config, { ...config, ...change }, t.create, t.onError)
  expect(t.manager.unregister).toHaveBeenCalledWith('weixin')
  expect(t.create).not.toHaveBeenCalled()
})
it('reports failed starts through the error handler', async () => {
  const t = setup()
  t.channel.start.mockRejectedValue(new Error('fixture failure'))
  await syncWeixinChannel(t.manager, config, config, t.create, t.onError)
  expect(t.onError).toHaveBeenCalledOnce()
})
