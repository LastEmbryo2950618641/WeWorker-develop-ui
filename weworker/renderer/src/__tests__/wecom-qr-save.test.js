import test from 'node:test'
import assert from 'node:assert/strict'
import { useSettingsStore } from '../store/settings.js'
import { configuredChannelIds } from '../utils/channel-configurations.js'
globalThis.window = {}

test('QR confirmation saves credentials and publishes a visible robot without retaining its secret', async (t) => {
  const previous = useSettingsStore.getState()
  t.after(() => useSettingsStore.setState(previous, true))
  useSettingsStore.setState({ channels: { ...previous.channels, qq: { app_id: 'fixture-qq' } } })
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.deepEqual(body, { wecom: { enabled: true, bot_id: 'fixture-bot', secret: 'fixture-secret' } })
    return Response.json({ wecom: { enabled: true, bot_id: 'fixture-bot', has_secret: true, owner_user_id: 'fixture-owner', owner_permission_level: 'qa_only' }, qq: { app_id: 'fixture-qq' } })
  })
  await useSettingsStore.getState().saveWecomQr({ bot_id: 'fixture-bot', secret: 'fixture-secret' })
  const state = useSettingsStore.getState()
  assert.ok(configuredChannelIds(state.channels).includes('wecom'))
  assert.equal(state.channels.wecom.owner_permission_level, 'qa_only')
  assert.equal(state.channels.qq.app_id, 'fixture-qq')
  assert.equal(state.wecomQrPending, null)
  assert.equal(state.wecomQrSaving, false)
  assert.equal(state.channels.wecom.secret, undefined)
})

test('failed save keeps QR credentials across page remount and permits retry without another scan', async (t) => {
  const previous = useSettingsStore.getState()
  t.after(() => useSettingsStore.setState(previous, true))
  let fail = true
  let release
  t.mock.method(globalThis, 'fetch', async () => {
    if (fail) return Response.json({}, { status: 503 })
    await new Promise(resolve => { release = resolve })
    return Response.json({ wecom: { enabled: true, bot_id: 'fixture-bot', has_secret: true } })
  })
  await assert.rejects(useSettingsStore.getState().saveWecomQr({ bot_id: 'fixture-bot', secret: 'fixture-secret' }))
  assert.equal(useSettingsStore.getState().wecomQrPending.bot_id, 'fixture-bot')
  assert.equal(useSettingsStore.getState().wecomQrSaving, false)
  fail = false
  const saving = useSettingsStore.getState().saveWecomQr()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(useSettingsStore.getState().wecomQrSaving, true)
  release()
  await saving
  assert.equal(useSettingsStore.getState().wecomQrPending, null)
  assert.ok(configuredChannelIds(useSettingsStore.getState().channels).includes('wecom'))
})
