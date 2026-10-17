import test from 'node:test'
import assert from 'node:assert/strict'
import { useSettingsStore } from '../store/settings.js'
import { requestBotQr } from '../utils/wecom-qr-request.js'

globalThis.window = {}
const credentials = { app_id: 'fixture-app', app_secret: 'fixture-secret' }
function setup(t) {
  const previous = useSettingsStore.getState()
  t.after(() => useSettingsStore.setState(previous, true))
  useSettingsStore.setState({ appBotQrPending: {}, appBotQrSaving: {}, channels: { qq: { app_id: 'fixture-old', owner_permission_level: 'full' }, feishu: {} } })
}
for (const channel of ['qq', 'feishu']) {
  test(`${channel} imports and saves only its credentials, new bot has QA permission`, async t => {
    setup(t)
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), { [channel]: { ...credentials, enabled: true, owner_user_id: '', owner_permission_level: 'qa_only' } })
      return Response.json({ [channel]: { app_id: credentials.app_id, enabled: true, has_app_secret: true, owner_permission_level: 'qa_only' } })
    })
    await useSettingsStore.getState().saveAppBotQr(channel, credentials)
    const state = useSettingsStore.getState()
    assert.equal(state.channels[channel].app_id, credentials.app_id)
    assert.equal(state.channels[channel].app_secret, undefined)
    assert.equal(state.appBotQrPending[channel], null)
    assert.equal(state.appBotQrSaving[channel], false)
  })
}
test('same bot retains saved owner and explicit permissions', async t => {
  setup(t)
  useSettingsStore.setState({ channels: { qq: { app_id: credentials.app_id, owner_user_id: 'fixture-owner', owner_permission_level: 'full' } } })
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { qq: { ...credentials, enabled: true } })
    return Response.json({ qq: { app_id: credentials.app_id, owner_user_id: 'fixture-owner', owner_permission_level: 'full' } })
  })
  await useSettingsStore.getState().saveAppBotQr('qq', credentials)
  assert.equal(useSettingsStore.getState().channels.qq.owner_permission_level, 'full')
})
test('failed save retains pending credentials for page remount and retry', async t => {
  setup(t)
  let failed = true
  t.mock.method(globalThis, 'fetch', async () => failed ? Response.json({}, { status: 503 }) : Response.json({ qq: { app_id: credentials.app_id, has_app_secret: true } }))
  await assert.rejects(useSettingsStore.getState().saveAppBotQr('qq', credentials), /重试保存/)
  assert.deepEqual(useSettingsStore.getState().appBotQrPending.qq, credentials)
  assert.equal(useSettingsStore.getState().appBotQrSaving.qq, false)
  failed = false
  await useSettingsStore.getState().saveAppBotQr('qq')
  assert.equal(useSettingsStore.getState().appBotQrPending.qq, null)
})
test('simultaneous channel imports do not overwrite each other with stale snapshots', async t => {
  setup(t)
  const releases = {}
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const channel = Object.keys(JSON.parse(options.body))[0]
    return new Promise(resolve => { releases[channel] = resolve })
  })
  const qq = useSettingsStore.getState().saveAppBotQr('qq', credentials)
  const feishu = useSettingsStore.getState().saveAppBotQr('feishu', credentials)
  await assert.rejects(useSettingsStore.getState().saveAppBotQr('qq', credentials), /正在保存/)
  await new Promise(resolve => setImmediate(resolve))
  releases.feishu(Response.json({ qq: { app_id: 'fixture-old' }, feishu: { app_id: 'fixture-feishu' } }))
  await feishu
  releases.qq(Response.json({ qq: { app_id: 'fixture-qq' }, feishu: { app_id: 'fixture-old' } }))
  await qq
  assert.equal(useSettingsStore.getState().channels.qq.app_id, 'fixture-qq')
  assert.equal(useSettingsStore.getState().channels.feishu.app_id, 'fixture-feishu')
})
test('QR requests route to the selected platform without exposing service errors', async () => {
  await requestBotQr('feishu', 'poll', { session_id: 'fixture' }, async (url, options) => {
    assert.equal(url, '/settings/feishu/qr-poll')
    assert.deepEqual(JSON.parse(options.body), { session_id: 'fixture' })
    return Response.json({ status: 'waiting' })
  })
  await assert.rejects(requestBotQr('qq', 'start', {}, async () => Response.json({ detail: 'fixture-secret' }, { status: 502 })), /QQ扫码服务请求失败/)
  await assert.rejects(requestBotQr('unsupported', 'start'), /不支持/)
})
