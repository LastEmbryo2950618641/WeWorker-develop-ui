import { randomUUID } from 'node:crypto'

// Protocol used by the official @wecom/wecom-openclaw-cli 1.1.1.
// https://open.work.weixin.qq.com/help2/pc/21670
const ORIGIN = 'https://work.weixin.qq.com'
const TTL = 5 * 60_000
type Session = { id: string; scode: string; expires: number }

export class WecomQrService {
  private session: Session | null = null
  private expiryTimer?: ReturnType<typeof setTimeout>
  constructor(private request: typeof fetch = fetch, private now = Date.now) {}

  private async get(path: string) {
    try {
      const res = await this.request(`${ORIGIN}${path}`, {
        signal: AbortSignal.timeout(15_000), redirect: 'error',
      })
      if (!res.ok) throw new Error('request failed')
      const body = await res.json()
      if (body?.errcode && body.errcode !== 0) throw new Error('upstream error')
      return body?.data
    } catch {
      // Never expose upstream payloads, authorization URLs or credentials in errors.
      throw new Error('企业微信扫码服务暂不可用，请稍后重试')
    }
  }

  async start() {
    this.clear()
    const session: Session = { id: randomUUID(), scode: '', expires: this.now() + TTL }
    this.session = session
    this.expiryTimer = setTimeout(() => this.cancel(session.id), TTL)
    this.expiryTimer.unref()
    try {
      const plat = process.platform === 'win32' ? 2 : process.platform === 'darwin' ? 1 : process.platform === 'linux' ? 3 : 0
      const data = await this.get(`/ai/qc/generate?source=wecom-cli&plat=${plat}`)
      if (this.session !== session) throw new Error('扫码已取消，请重新获取')
      if (typeof data?.scode !== 'string' || !data.scode || typeof data.auth_url !== 'string') throw new Error('企业微信未返回有效二维码')
      const url = new URL(data.auth_url)
      if (url.protocol !== 'https:' || url.hostname !== 'work.weixin.qq.com' || url.username || url.password) throw new Error('企业微信返回的二维码地址无效')
      session.scode = data.scode
      return { session_id: session.id, qrcode_url: data.auth_url, expires_at: session.expires }
    } catch (error) {
      this.cancel(session.id)
      throw error
    }
  }

  async poll(id: string) {
    const session = this.session
    if (!session || session.id !== id || !session.scode || this.now() >= session.expires) {
      this.cancel(id)
      return { status: 'expired' as const }
    }
    const data = await this.get(`/ai/qc/query_result?scode=${encodeURIComponent(session.scode)}`)
    if (this.session !== session || this.now() >= session.expires) return { status: 'expired' as const }
    if (data?.status === 'success') {
      const info = data.bot_info
      if (typeof info?.botid !== 'string' || !info.botid.trim() || typeof info.secret !== 'string' || !info.secret.trim()) {
        throw new Error('机器人已创建，但未返回完整配置，请重新扫码或手动填写')
      }
      return { status: 'confirmed' as const, bot_id: info.botid, secret: info.secret }
    }
    if (data?.status === 'expired') { this.cancel(id); return { status: 'expired' as const } }
    return { status: 'waiting' as const }
  }

  cancel(id: string) {
    if (this.session?.id === id) this.clear()
  }

  private clear() {
    clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
    this.session = null
  }
}
