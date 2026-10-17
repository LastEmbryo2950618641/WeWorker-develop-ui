import { describe, expect, it, vi } from 'vitest'
import { WecomQrService } from '../channels/wecom-qr.js'

const qr = { data: { scode: 'fixture-session', auth_url: 'https://work.weixin.qq.com/fixture' } }
const success = { data: { status: 'success', bot_info: { botid: 'fixture-bot', secret: 'fixture-secret' } } }
const response = (body: unknown) => new Response(JSON.stringify(body))

describe('WeCom QR onboarding', () => {
  it('returns an opaque session and imports the official bot result', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(qr)).mockResolvedValueOnce(response({ data: { status: 'waiting' } })).mockResolvedValueOnce(response(success))
    const service = new WecomQrService(request)
    const start = await service.start()
    expect(start).not.toHaveProperty('scode')
    expect(start.session_id).not.toBe('fixture-session')
    expect(await service.poll(start.session_id)).toEqual({ status: 'waiting' })
    expect(await service.poll(start.session_id)).toEqual({ status: 'confirmed', bot_id: 'fixture-bot', secret: 'fixture-secret' })
    expect(request.mock.calls[1][0]).toBe('https://work.weixin.qq.com/ai/qc/query_result?scode=fixture-session')
    service.cancel(start.session_id)
    expect(await service.poll(start.session_id)).toEqual({ status: 'expired' })
  })
  it('expires sessions and refuses other session IDs without querying the service', async () => {
    let now = 0
    const request = vi.fn().mockResolvedValue(response(qr))
    const service = new WecomQrService(request, () => now)
    const start = await service.start()
    expect(await service.poll('unrelated')).toEqual({ status: 'expired' })
    now = 300001
    expect(await service.poll(start.session_id)).toEqual({ status: 'expired' })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('drops in-flight credentials after cancel', async () => {
    let resolve!: (value: Response) => void
    const request = vi.fn().mockResolvedValueOnce(response(qr)).mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    const service = new WecomQrService(request)
    const start = await service.start()
    const pending = service.poll(start.session_id)
    service.cancel(start.session_id)
    resolve(response(success))
    expect(await pending).toEqual({ status: 'expired' })
  })
  it('new sessions invalidate previous sessions', async () => {
    const request = vi.fn().mockImplementation(() => Promise.resolve(response(qr)))
    const service = new WecomQrService(request)
    const first = await service.start()
    const second = await service.start()
    service.cancel(first.session_id)
    expect(await service.poll(first.session_id)).toEqual({ status: 'expired' })
    expect(await service.poll(second.session_id)).toEqual({ status: 'waiting' })
    service.cancel(second.session_id)
  })
  it('rejects untrusted authorization URLs and missing credentials', async () => {
    const service = new WecomQrService(vi.fn().mockResolvedValue(response({ data: { scode: 'fixture', auth_url: 'https://example.com' } })))
    await expect(service.start()).rejects.toThrow('二维码地址无效')
    const incomplete = new WecomQrService(vi.fn().mockResolvedValueOnce(response(qr)).mockResolvedValueOnce(response({ data: { status: 'success', bot_info: { botid: 'fixture-bot' } } })))
    const start = await incomplete.start()
    await expect(incomplete.poll(start.session_id)).rejects.toThrow('未返回完整配置')
    incomplete.cancel(start.session_id)
  })
  it('does not expose network errors or upstream response content', async () => {
    const service = new WecomQrService(vi.fn().mockRejectedValue(new Error('fixture-private-query')))
    await expect(service.start()).rejects.toThrow('企业微信扫码服务暂不可用')
  })
})
