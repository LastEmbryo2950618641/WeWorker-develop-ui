import { randomUUID } from 'node:crypto'
import { startQrConnect } from '@tencent-connect/qqbot-connector'

type Credentials = { app_id: string; app_secret: string }
type QrResult = { status: 'waiting' | 'expired' | 'error'; message?: string; poll_interval_ms?: number } | ({ status: 'confirmed' } & Credentials)
const validText = (value: unknown): value is string => typeof value === 'string' && !!value.trim()

export class QqQrService {
  private session?: { id: string; expires: number; controller: AbortController; stop?: () => void; timer?: ReturnType<typeof setTimeout>; result: QrResult; rejectStart?: (error: Error) => void }
  constructor(private connect = startQrConnect, private now = Date.now) {}

  async start() {
    if (this.session) this.cancel(this.session.id)
    const session: NonNullable<QqQrService['session']> = { id: randomUUID(), expires: this.now() + 300_000, controller: new AbortController(), result: { status: 'waiting' } }
    this.session = session
    session.timer = setTimeout(() => this.cancel(session.id), 300_000)
    session.timer.unref()
    return new Promise<{ session_id: string; qrcode_url: string; expires_at: number; poll_interval_ms: number }>((resolve, reject) => {
      const timeout = setTimeout(() => this.cancel(session.id), 15_000)
      const failStart = (error: Error) => { clearTimeout(timeout); reject(error) }
      session.rejectStart = failStart
      try {
        session.stop = this.connect({
          onQrDisplayed: raw => {
            if (this.session !== session) return
            try {
              const url = new URL(raw)
              if (url.protocol !== 'https:' || url.hostname !== 'q.qq.com' || url.username || url.password) throw new Error()
              clearTimeout(timeout)
              session.rejectStart = undefined
              resolve({ session_id: session.id, qrcode_url: raw, expires_at: session.expires, poll_interval_ms: 2000 })
            } catch { this.cancel(session.id) }
          },
          onSuccess: values => {
            if (this.session !== session || this.now() >= session.expires) return
            const value = values[0]
            session.result = validText(value?.appId) && validText(value?.appSecret)
              ? { status: 'confirmed', app_id: value.appId, app_secret: value.appSecret }
              : { status: 'error', message: 'QQ 未返回完整凭证，请重新扫码或手动填写' }
          },
          onFailure: () => {
            if (this.session !== session) return
            if (session.rejectStart) {
              session.rejectStart(new Error('QQ 扫码服务暂不可用，请稍后重试'))
              session.rejectStart = undefined
              this.cancel(session.id)
              return
            }
            session.rejectStart = undefined
            session.result = { status: 'error', message: 'QQ 扫码失败，请重新获取二维码' }
          },
          onQrExpired: () => this.cancel(session.id),
        }, { displayQrCodeToConsole: false, source: '', signal: session.controller.signal })
        if (this.session !== session) session.stop()
      } catch { this.cancel(session.id) }
    })
  }

  poll(id: string): QrResult {
    if (!this.session || this.session.id !== id || this.now() >= this.session.expires) {
      this.cancel(id)
      return { status: 'expired' }
    }
    return this.session.result
  }

  cancel(id: string) {
    const session = this.session
    if (!session || session.id !== id) return
    this.session = undefined
    clearTimeout(session.timer)
    session.rejectStart?.(new Error('QQ 扫码已取消或超时，请重新获取'))
    session.controller.abort()
    session.stop?.()
  }
}

type FeishuSession = { id: string; deviceCode: string; expires: number; interval: number; nextPoll: number; result?: QrResult; pending?: Promise<QrResult> }

// Registration protocol used by @larksuite/openclaw-lark-tools 1.0.47.
export class FeishuQrService {
  private session?: FeishuSession
  private timer?: ReturnType<typeof setTimeout>
  constructor(private request: typeof fetch = fetch, private now = Date.now) {}

  private async registration(fields: Record<string, string>) {
    try {
      const response = await this.request('https://accounts.feishu.cn/oauth/v1/app/registration', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(12_000), redirect: 'error',
      })
      const data = await response.json()
      if ((!response.ok && !(response.status === 400 && typeof data?.error === 'string')) || !data || typeof data !== 'object') throw new Error()
      return data
    } catch { throw new Error('飞书扫码服务暂不可用，请稍后重试') }
  }

  async start() {
    if (this.session) this.cancel(this.session.id)
    const session: FeishuSession = { id: randomUUID(), deviceCode: '', expires: this.now() + 600_000, interval: 5000, nextPoll: 0 }
    this.session = session
    try {
      const init = await this.registration({ action: 'init' })
      if (this.session !== session) throw new Error('扫码已取消')
      if (!Array.isArray(init.supported_auth_methods) || !init.supported_auth_methods.includes('client_secret')) throw new Error('飞书暂不支持当前创建方式，请手动配置')
      const data = await this.registration({ action: 'begin', archetype: 'PersonalAgent', auth_method: 'client_secret', request_user_info: 'open_id' })
      if (this.session !== session) throw new Error('扫码已取消')
      if (!validText(data.device_code) || !validText(data.verification_uri_complete)) throw new Error('飞书未返回有效二维码')
      const url = new URL(data.verification_uri_complete)
      if (url.protocol !== 'https:' || !(url.hostname === 'feishu.cn' || url.hostname.endsWith('.feishu.cn')) || url.username || url.password) throw new Error('飞书返回的二维码地址无效')
      url.searchParams.set('from', 'onboard')
      const ttl = Math.min(600, Math.max(1, Number(data.expire_in ?? data.expires_in) || 600)) * 1000
      session.deviceCode = data.device_code
      session.expires = this.now() + ttl
      session.interval = Math.min(30_000, Math.max(3000, (Number(data.interval) || 5) * 1000))
      session.nextPoll = this.now() + session.interval
      this.timer = setTimeout(() => this.cancel(session.id), ttl)
      this.timer.unref()
      return { session_id: session.id, qrcode_url: url.toString(), expires_at: session.expires, poll_interval_ms: session.interval }
    } catch (error) { this.cancel(session.id); throw error }
  }

  async poll(id: string): Promise<QrResult> {
    const session = this.session
    if (!session || session.id !== id || !session.deviceCode || this.now() >= session.expires) {
      this.cancel(id); return { status: 'expired' }
    }
    if (session.result) return session.result
    if (session.pending) return session.pending
    if (this.now() < session.nextPoll) return { status: 'waiting', poll_interval_ms: session.interval }
    session.pending = this.pollSession(session).finally(() => { session.pending = undefined })
    return session.pending
  }

  private async pollSession(session: FeishuSession): Promise<QrResult> {
    const data = await this.registration({ action: 'poll', device_code: session.deviceCode })
    if (this.session !== session || this.now() >= session.expires) return { status: 'expired' }
    session.nextPoll = this.now() + session.interval
    if (data.user_info?.tenant_brand === 'lark') return session.result = { status: 'error', message: '当前通道支持飞书，请使用飞书账号扫码' }
    if (validText(data.client_id) && validText(data.client_secret)) {
      return session.result = { status: 'confirmed', app_id: data.client_id, app_secret: data.client_secret }
    }
    if (data.error === 'authorization_pending') return { status: 'waiting', poll_interval_ms: session.interval }
    if (data.error === 'slow_down') {
      session.interval = Math.min(30_000, session.interval + 5000)
      session.nextPoll = this.now() + session.interval
      return { status: 'waiting', poll_interval_ms: session.interval }
    }
    if (data.error === 'expired_token') { this.cancel(session.id); return { status: 'expired' } }
    return session.result = { status: 'error', message: data.error === 'access_denied' ? '已取消飞书授权，请重新扫码或手动填写' : '飞书未返回完整凭证，请重新扫码或手动填写' }
  }

  cancel(id: string) {
    if (this.session?.id !== id) return
    this.session = undefined
    clearTimeout(this.timer)
    this.timer = undefined
  }
}
