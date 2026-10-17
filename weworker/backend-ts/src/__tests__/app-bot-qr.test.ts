import { afterEach, expect, it, vi } from 'vitest'
import { QqQrService, FeishuQrService } from '../channels/app-bot-qr.js'
import { startQrConnect } from '@tencent-connect/qqbot-connector'

afterEach(() => vi.useRealTimers())
function qqFixture() {
  vi.useFakeTimers()
  let callbacks!: Parameters<typeof startQrConnect>[0]
  const stop = vi.fn()
  const connect = vi.fn<typeof startQrConnect>((cb) => { callbacks = cb; return stop })
  const service = new QqQrService(connect)
  const starting = service.start()
  callbacks.onQrDisplayed!('https://q.qq.com/qqbot/openclaw/connect.html?task_id=fixture')
  return { service, starting, callbacks, stop, connect }
}
it('QQ SDK credentials are normalized, cached and discarded on cancellation', async () => {
  const t = qqFixture(), qr = await t.starting
  expect(t.connect.mock.calls[0][1]?.displayQrCodeToConsole).toBe(false)
  expect(t.service.poll(qr.session_id).status).toBe('waiting')
  t.callbacks.onSuccess([{ appId: 'fixture-app', appSecret: 'fixture-secret', userOpenid: 'fixture-user' }])
  expect(t.service.poll(qr.session_id)).toEqual({ status: 'confirmed', app_id: 'fixture-app', app_secret: 'fixture-secret' })
  t.service.cancel(qr.session_id)
  t.callbacks.onSuccess([{ appId: 'fixture-late', appSecret: 'fixture-secret' }])
  expect(t.service.poll(qr.session_id)).toEqual({ status: 'expired' })
  expect(t.stop).toHaveBeenCalledOnce()
})
it('QQ expiration and SDK failures expose no remote error details', async () => {
  const t = qqFixture(), qr = await t.starting
  t.callbacks.onFailure(new Error('fixture-sensitive-error'))
  expect(t.service.poll(qr.session_id)).toEqual({ status: 'error', message: 'QQ 扫码失败，请重新获取二维码' })
  await vi.advanceTimersByTimeAsync(300_000)
  expect(t.service.poll(qr.session_id).status).toBe('expired')
})
it('QQ refuses unexpected QR origins and stops a synchronous SDK', async () => {
  const stop = vi.fn()
  const service = new QqQrService(cb => { cb.onQrDisplayed!('https://example.com/fixture'); return stop })
  await expect(service.start()).rejects.toThrow('取消或超时')
  expect(stop).toHaveBeenCalledOnce()
})
it('QQ replacement invalidates the old session and ignores late callbacks', async () => {
  const t = qqFixture(), first = await t.starting
  const oldCallback = t.callbacks
  const second = t.service.start()
  const current = t.connect.mock.calls[1][0]
  current.onQrDisplayed!('https://q.qq.com/qqbot/openclaw/connect.html?task_id=fixture-new')
  const qr = await second
  oldCallback.onSuccess([{ appId: 'fixture-old', appSecret: 'fixture-secret' }])
  expect(t.service.poll(first.session_id).status).toBe('expired')
  expect(t.service.poll(qr.session_id).status).toBe('waiting')
  t.service.cancel(qr.session_id)
})
it('QQ start timeout stops SDK polling', async () => {
  vi.useFakeTimers()
  const stop = vi.fn(), service = new QqQrService(() => stop)
  const result = expect(service.start()).rejects.toThrow('超时')
  await vi.advanceTimersByTimeAsync(15_000)
  await result
  expect(stop).toHaveBeenCalledOnce()
})

function feishuFixture(polls: unknown[], begin: Record<string, unknown> = {}) {
  vi.useFakeTimers()
  const request = vi.fn<typeof fetch>(async (_url, options) => {
    const fields = new URLSearchParams(String(options?.body))
    const action = fields.get('action')
    if (action === 'init') return Response.json({ supported_auth_methods: ['client_secret'] })
    if (action === 'begin') return Response.json({ device_code: 'fixture-device', verification_uri_complete: 'https://accounts.feishu.cn/fixture', expire_in: 600, interval: 3, ...begin })
    return Response.json(polls.shift())
  })
  return { request, service: new FeishuQrService(request) }
}
it('Feishu follows registration protocol, throttles polls, caches credentials', async () => {
  const t = feishuFixture([{ error: 'authorization_pending' }, { client_id: 'fixture-app', client_secret: 'fixture-secret' }])
  const qr = await t.service.start()
  expect(qr.qrcode_url).toBe('https://accounts.feishu.cn/fixture?from=onboard')
  expect(Object.fromEntries(new URLSearchParams(String(t.request.mock.calls[1][1]?.body)))).toEqual({ action: 'begin', archetype: 'PersonalAgent', auth_method: 'client_secret', request_user_info: 'open_id' })
  expect((await t.service.poll(qr.session_id)).status).toBe('waiting')
  expect(t.request).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(3000)
  expect((await t.service.poll(qr.session_id)).status).toBe('waiting')
  await vi.advanceTimersByTimeAsync(3000)
  expect(await t.service.poll(qr.session_id)).toEqual({ status: 'confirmed', app_id: 'fixture-app', app_secret: 'fixture-secret' })
  await t.service.poll(qr.session_id)
  expect(t.request).toHaveBeenCalledTimes(4)
  t.service.cancel(qr.session_id)
  expect((await t.service.poll(qr.session_id)).status).toBe('expired')
})
it.each(['access_denied', 'expired_token', 'unknown'])('Feishu handles terminal OAuth result %s', async error => {
  const t = feishuFixture([{ error, error_description: 'fixture-private-error' }]), qr = await t.service.start()
  await vi.advanceTimersByTimeAsync(3000)
  const result = await t.service.poll(qr.session_id)
  expect(result.status).toBe(error === 'expired_token' ? 'expired' : 'error')
  expect(JSON.stringify(result)).not.toContain('fixture-private-error')
  t.service.cancel(qr.session_id)
})
it('Feishu backs off on slow_down and expires', async () => {
  const t = feishuFixture([{ error: 'slow_down' }]), qr = await t.service.start()
  await vi.advanceTimersByTimeAsync(3000)
  expect(await t.service.poll(qr.session_id)).toEqual({ status: 'waiting', poll_interval_ms: 8000 })
  await vi.advanceTimersByTimeAsync(7000)
  await t.service.poll(qr.session_id)
  expect(t.request).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(600_000)
  expect((await t.service.poll(qr.session_id)).status).toBe('expired')
})
it('Feishu deduplicates concurrent polling and ignores results after cancel', async () => {
  const t = feishuFixture([]), qr = await t.service.start()
  let release!: (value: Response) => void
  t.request.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  await vi.advanceTimersByTimeAsync(3000)
  const first = t.service.poll(qr.session_id), second = t.service.poll(qr.session_id)
  expect(t.request).toHaveBeenCalledTimes(3)
  t.service.cancel(qr.session_id)
  release(Response.json({ client_id: 'fixture-app', client_secret: 'fixture-secret' }))
  expect(await first).toEqual({ status: 'expired' })
  expect(await second).toEqual({ status: 'expired' })
})
it.each(['https://example.com/fixture', 'http://accounts.feishu.cn/fixture', 'https://fixture:fixture@accounts.feishu.cn/'])('Feishu validates QR URL %s', async verification_uri_complete => {
  const t = feishuFixture([], { verification_uri_complete })
  await expect(t.service.start()).rejects.toThrow('地址无效')
})
it('Feishu sanitizes network failures', async () => {
  const service = new FeishuQrService(async () => { throw new Error('fixture-private-error') })
  await expect(service.start()).rejects.toThrow('飞书扫码服务暂不可用，请稍后重试')
})
it('Feishu accepts OAuth pending returned with HTTP 400', async () => {
  const t = feishuFixture([]), qr = await t.service.start()
  t.request.mockResolvedValueOnce(Response.json({ error: 'authorization_pending' }, { status: 400 }))
  await vi.advanceTimersByTimeAsync(3000)
  expect((await t.service.poll(qr.session_id)).status).toBe('waiting')
  t.service.cancel(qr.session_id)
})
it('Feishu reports unsupported registration instead of continuing without credentials', async () => {
  const service = new FeishuQrService(async () => Response.json({ supported_auth_methods: [] }))
  await expect(service.start()).rejects.toThrow('手动配置')
})
it('Feishu refuses international credentials for the domestic channel', async () => {
  const t = feishuFixture([{ client_id: 'fixture-app', client_secret: 'fixture-secret', user_info: { tenant_brand: 'lark' } }]), qr = await t.service.start()
  await vi.advanceTimersByTimeAsync(3000)
  expect((await t.service.poll(qr.session_id)).status).toBe('error')
  t.service.cancel(qr.session_id)
})
