import test from 'node:test'
import assert from 'node:assert/strict'
import { channelProbeConfig, requestChannelProbe } from '../utils/channel-probe.js'
globalThis.window = {}
test('sends only connection fields and retains empty secret fallback', () => {
  assert.deepEqual(channelProbeConfig('wecom', { bot_id: ' fixture-bot ', secret: '', enabled: true, owner_permission_level: 'full' }), { bot_id: 'fixture-bot', secret: '' })
  assert.deepEqual(channelProbeConfig('weixin', { token: ' fixture-token ', base_url: '' }), { token: 'fixture-token', base_url: '' })
})
test('different channel probes can remain in flight concurrently', async t => {
  const pending = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.ok(options.signal)
    const body = JSON.parse(options.body)
    await new Promise(resolve => pending.push(resolve))
    return Response.json({ ok: true, duration_ms: 12, checks: [{ target: 'platform', label: body.channel, status: 'success', message: '验证通过' }] })
  })
  const requests = ['qq', 'feishu'].map(channel => requestChannelProbe(channel, { app_id: 'fixture-app' }, new AbortController().signal))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pending.length, 2)
  pending.forEach(resolve => resolve())
  assert.deepEqual((await Promise.all(requests)).map(result => result.checks[0].label), ['qq', 'feishu'])
})
test('old backend and duplicate checks have actionable errors without HTML output', async t => {
  let status = 404
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>fixture</html>', { status }))
  await assert.rejects(requestChannelProbe('qq', {}), /重启 WeWorker/)
  status = 409
  await assert.rejects(requestChannelProbe('qq', {}), /正在检测/)
})
test('malformed and incomplete results are never shown as successful', async t => {
  let value = {}
  t.mock.method(globalThis, 'fetch', async () => Response.json(value))
  await assert.rejects(requestChannelProbe('qq', {}), /格式异常/)
  value = { ok: true, checks: [{ status: 'skipped', label: '平台验证', message: '尚未验证' }] }
  assert.equal((await requestChannelProbe('qq', {})).ok, false)
})
