/**
 * WeChat (微信) "scan to log in a bot" flow for dedicated agents.
 *
 * Same iLink endpoints the main WeChat channel uses (get_bot_qrcode /
 * get_qrcode_status). The bot token stays in backend memory until a dedicated
 * agent consumes it; poll responses never include it.
 */
import { randomUUID } from 'node:crypto'
import { assertAllowedWeixinBaseUrl, DEFAULT_WEIXIN_BASE_URL } from '../channel-egress.js'
import { fetchQRCode, pollQRStatus, type QRCodeResp, type QRStatusResp } from '../channels/weixin-channel.js'

export const WEIXIN_QR_SESSION_TTL_MS = 5 * 60_000
const RESULT_TTL_MS = 10 * 60_000
const MAX_SESSIONS = 20

export interface WeixinBotCredentials {
  botId: string
  token: string
  baseUrl: string
}

interface QrSession {
  qrcode: string
  baseUrl: string
  startedAt: number
  result: (WeixinBotCredentials & { at: number }) | null
}

export type WeixinQrPollResult =
  | { status: 'waiting' }
  | { status: 'scanned' }
  | { status: 'success'; bot_id: string }
  | { status: 'expired' }

export interface WeixinQrDeps {
  fetchQr?: (baseUrl: string) => Promise<QRCodeResp>
  pollQr?: (baseUrl: string, qrcode: string) => Promise<QRStatusResp>
  now?: () => number
  /** Base URL used to request the QR code (validated against the WeChat allowlist). */
  baseUrl?: string
  allowedBaseUrls?: Set<string>
}

export function createWeixinQrSessions(deps: WeixinQrDeps = {}) {
  const sessions = new Map<string, QrSession>()
  const fetchQr = deps.fetchQr ?? fetchQRCode
  const pollQr = deps.pollQr ?? pollQRStatus
  const now = deps.now ?? Date.now
  const validate = (raw: string | undefined) => assertAllowedWeixinBaseUrl(raw, deps.allowedBaseUrls)

  const prune = () => {
    const current = now()
    for (const [id, session] of sessions) {
      const expired = session.result
        ? current - session.result.at > RESULT_TTL_MS
        : current - session.startedAt > WEIXIN_QR_SESSION_TTL_MS
      if (expired) sessions.delete(id)
    }
    while (sessions.size > MAX_SESSIONS) {
      const oldest = sessions.keys().next().value
      if (!oldest) break
      sessions.delete(oldest)
    }
  }

  return {
    async start(): Promise<{ session_id: string; qr_url: string; expires_in: number }> {
      prune()
      const baseUrl = validate(deps.baseUrl ?? DEFAULT_WEIXIN_BASE_URL)
      let qr: QRCodeResp
      try {
        qr = await fetchQr(baseUrl)
      } catch {
        throw new Error('获取微信二维码失败，请稍后重试')
      }
      if (typeof qr?.qrcode !== 'string' || !qr.qrcode || typeof qr.qrcode_img_content !== 'string' || !qr.qrcode_img_content) {
        throw new Error('微信未返回有效二维码，请稍后重试')
      }
      const id = randomUUID()
      sessions.set(id, { qrcode: qr.qrcode, baseUrl, startedAt: now(), result: null })
      return { session_id: id, qr_url: qr.qrcode_img_content, expires_in: Math.round(WEIXIN_QR_SESSION_TTL_MS / 1000) }
    },

    async poll(sessionId: string): Promise<WeixinQrPollResult> {
      prune()
      const session = sessions.get(sessionId)
      if (!session) return { status: 'expired' }
      if (session.result) return { status: 'success', bot_id: session.result.botId }
      const status = await pollQr(session.baseUrl, session.qrcode)
      if (sessions.get(sessionId) !== session) return { status: 'expired' }
      if (status?.status === 'confirmed') {
        const token = typeof status.bot_token === 'string' ? status.bot_token.trim() : ''
        if (!token) throw new Error('扫码成功，但未拿到机器人凭证，请重新扫码')
        const botId = typeof status.ilink_bot_id === 'string' ? status.ilink_bot_id.trim() : ''
        // The login may move the bot to another iLink host; it must still be allowlisted.
        const baseUrl = validate(status.baseurl || session.baseUrl)
        session.result = { botId, token, baseUrl, at: now() }
        return { status: 'success', bot_id: botId }
      }
      if (status?.status === 'expired') {
        sessions.delete(sessionId)
        return { status: 'expired' }
      }
      if (status?.status === 'scaned') return { status: 'scanned' }
      return { status: 'waiting' }
    },

    /** Read scanned credentials without removing them (consume after the caller succeeds). */
    peek(sessionId: string): WeixinBotCredentials | null {
      prune()
      const result = sessions.get(sessionId)?.result
      return result ? { botId: result.botId, token: result.token, baseUrl: result.baseUrl } : null
    },

    consume(sessionId: string): WeixinBotCredentials | null {
      const credentials = this.peek(sessionId)
      if (credentials) sessions.delete(sessionId)
      return credentials
    },
  }
}
