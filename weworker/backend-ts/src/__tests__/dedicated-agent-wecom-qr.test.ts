import { describe, expect, it, vi } from 'vitest'
import { createWecomQrSessions, QR_SESSION_TTL_MS, wecomPlatCode } from '../dedicated-agents/wecom-qr.js'

const qr = { data: { scode: 'fixture-scode', auth_url: 'https://work.weixin.qq.com/fixture-auth' } }
const success = { data: { status: 'success', bot_info: { botid: 'placeholder-bot', secret: 'placeholder-secret' } } }
const reply = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 502, json: async () => body })

describe('dedicated agent WeCom QR sessions', () => {
  it('maps platforms to the WeCom plat codes', () => {
    expect(wecomPlatCode('darwin')).toBe(1)
    expect(wecomPlatCode('win32')).toBe(2)
    expect(wecomPlatCode('linux')).toBe(3)
    expect(wecomPlatCode('aix')).toBe(0)
  })

  it('keeps the secret in backend memory and never returns it from poll', async () => {
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => reply(qr))
      .mockImplementationOnce(() => reply({ data: { status: 'waiting' } }))
      .mockImplementationOnce(() => reply(success))
    const sessions = createWecomQrSessions({ fetchImpl })
    const started = await sessions.start()
    expect(started.qr_url).toBe('https://work.weixin.qq.com/fixture-auth')
    expect(started).not.toHaveProperty('scode')
    expect(await sessions.poll(started.session_id)).toEqual({ status: 'waiting' })
    const confirmed = await sessions.poll(started.session_id)
    expect(confirmed).toEqual({ status: 'success', bot_id: 'placeholder-bot' })
    expect(JSON.stringify(confirmed)).not.toContain('placeholder-secret')
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'error' })

    expect(sessions.peek(started.session_id)).toEqual({ botId: 'placeholder-bot', secret: 'placeholder-secret' })
    expect(sessions.consume(started.session_id)).toEqual({ botId: 'placeholder-bot', secret: 'placeholder-secret' })
    expect(sessions.consume(started.session_id)).toBeNull()
    expect(await sessions.poll(started.session_id)).toEqual({ status: 'expired' })
  })

  it('expires unscanned sessions', async () => {
    let now = 0
    const fetchImpl = vi.fn().mockImplementation(() => reply(qr))
    const sessions = createWecomQrSessions({ fetchImpl, now: () => now })
    const started = await sessions.start()
    now = QR_SESSION_TTL_MS + 1
    expect(await sessions.poll(started.session_id)).toEqual({ status: 'expired' })
    expect(await sessions.poll('unknown')).toEqual({ status: 'expired' })
  })

  it('rejects QR URLs outside work.weixin.qq.com and HTTP errors', async () => {
    const untrusted = createWecomQrSessions({ fetchImpl: () => reply({ data: { scode: 'x', auth_url: 'https://example.com/qr' } }) })
    await expect(untrusted.start()).rejects.toThrow('获取企业微信二维码失败')
    const failing = createWecomQrSessions({ fetchImpl: () => reply({}, false) })
    await expect(failing.start()).rejects.toThrow('HTTP 502')
  })
})
