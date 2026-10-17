import test from 'node:test'
import assert from 'node:assert/strict'
import { requestWecomQr } from '../utils/wecom-qr-request.js'

test('old backend HTML 404 explains restart instead of a JSON parse or network error', async () => {
  await assert.rejects(requestWecomQr('start', null, async () => new Response('<html>Cannot POST</html>', { status: 404 })), /尚未加载扫码功能/)
})
test('distinguishes authentication, upstream, unavailable and timeout failures', async () => {
  for (const [status, message] of [[401, /认证失败/], [403, /认证失败/], [502, /HTTP 502/]]) {
    await assert.rejects(requestWecomQr('start', null, async () => new Response('fixture', { status })), message)
  }
  await assert.rejects(requestWecomQr('start', null, async () => { throw new TypeError('fetch failed') }), /无法连接 WeWorker 后端/)
  await assert.rejects(requestWecomQr('start', null, async () => { throw new DOMException('fixture', 'TimeoutError') }), /请求超时/)
})
test('preserves successful data without returning upstream error payloads', async () => {
  const data = { session_id: 'fixture', qrcode_url: 'https://example.com/qr' }
  assert.deepEqual(await requestWecomQr('start', null, async () => Response.json(data)), data)
  await assert.rejects(requestWecomQr('start', null, async () => new Response('invalid')), /返回格式异常/)
})
