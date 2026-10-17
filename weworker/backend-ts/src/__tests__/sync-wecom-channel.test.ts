import { expect, it, vi } from 'vitest'
import { syncWecomChannel } from '../channels/sync-wecom-channel.js'

const config = { enabled: true, bot_id: 'fixture-bot', secret: 'fixture-secret' }
function setup(registered = false) {
  let exists = registered
  const manager = {
    has: () => exists,
    register: vi.fn(() => { exists = true }),
    unregister: vi.fn(async () => { exists = false }),
  }
  const channel = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), getStatus: () => ({ status: 'starting' as const }) }
  const create = vi.fn(() => channel)
  return { manager, channel, create, onError: vi.fn() }
}
it('starts a newly configured bot', async () => {
  const t = setup()
  await syncWecomChannel(t.manager, config, config, t.create, t.onError)
  expect(t.create).toHaveBeenCalledWith(config)
  expect(t.channel.start).toHaveBeenCalledOnce()
})
it.each([{ bot_id: 'fixture-new' }, { secret: 'fixture-new-secret' }])('replaces the old connection when credentials change: %j', async change => {
  const t = setup(true)
  await syncWecomChannel(t.manager, config, { ...config, ...change }, t.create, t.onError)
  expect(t.manager.unregister).toHaveBeenCalledWith('wecom')
  expect(t.channel.start).toHaveBeenCalledOnce()
  expect(t.manager.unregister.mock.invocationCallOrder[0]).toBeLessThan(t.manager.register.mock.invocationCallOrder[0])
})
it('keeps an unchanged connection', async () => {
  const t = setup(true)
  await syncWecomChannel(t.manager, config, config, t.create, t.onError)
  expect(t.manager.unregister).not.toHaveBeenCalled()
  expect(t.create).not.toHaveBeenCalled()
})
it('stops a disabled channel', async () => {
  const t = setup(true)
  await syncWecomChannel(t.manager, config, { ...config, enabled: false }, t.create, t.onError)
  expect(t.manager.unregister).toHaveBeenCalledWith('wecom')
  expect(t.create).not.toHaveBeenCalled()
})
it('handles a rejected connection start', async () => {
  const t = setup()
  t.channel.start.mockRejectedValue(new Error('fixture connection failure'))
  await syncWecomChannel(t.manager, config, config, t.create, t.onError)
  expect(t.onError).toHaveBeenCalledOnce()
})
