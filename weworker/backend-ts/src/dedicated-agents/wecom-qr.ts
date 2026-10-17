/**
 * WeCom "scan to create / authorize an AI bot" flow.
 *
 * Same public endpoints the official WeCom CLI uses:
 *   GET https://work.weixin.qq.com/ai/qc/generate?source=<source>&plat=<1|2|3>
 *       -> { data: { scode, auth_url } }      auth_url is rendered as the QR code
 *   GET https://work.weixin.qq.com/ai/qc/query_result?scode=<scode>
 *       -> { data: { status: 'success', bot_info: { botid, secret } } } once scanned
 *
 * Credentials stay in backend memory until a dedicated agent consumes them.
 */
import { randomUUID } from 'node:crypto'

const QR_GENERATE_URL = 'https://work.weixin.qq.com/ai/qc/generate'
const QR_QUERY_URL = 'https://work.weixin.qq.com/ai/qc/query_result'
const AUTH_URL_PREFIX = 'https://work.weixin.qq.com/'
// Same source value as the main channel scan flow (channels/wecom-qr.ts).
const QR_SOURCE = 'wecom-cli'
export const QR_SESSION_TTL_MS = 5 * 60_000
const RESULT_TTL_MS = 10 * 60_000
const MAX_SESSIONS = 20
const REQUEST_TIMEOUT_MS = 15_000

type FetchLike = (input: string, init?: { signal?: AbortSignal; redirect?: 'error' }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export function wecomPlatCode(platform: NodeJS.Platform = process.platform): number {
  if (platform === 'darwin') return 1
  if (platform === 'win32') return 2
  if (platform === 'linux') return 3
  return 0
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error' })
  if (!response.ok) throw new Error(`企业微信服务返回 HTTP ${response.status}`)
  const body = await response.json()
  return body && typeof body === 'object' ? body as Record<string, unknown> : {}
}

export async function requestWecomBotQr(fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<{ scode: string; authUrl: string }> {
  const url = `${QR_GENERATE_URL}?source=${QR_SOURCE}&plat=${wecomPlatCode()}`
  const body = await getJson(fetchImpl, url)
  const data = (body.data ?? {}) as Record<string, unknown>
  const scode = typeof data.scode === 'string' ? data.scode : ''
  const authUrl = typeof data.auth_url === 'string' ? data.auth_url : ''
  if (!scode || !authUrl.startsWith(AUTH_URL_PREFIX)) throw new Error('获取企业微信二维码失败，请稍后重试')
  return { scode, authUrl }
}

export type WecomQrQuery =
  | { status: 'success'; botId: string; secret: string }
  | { status: 'waiting'; detail: string }

export async function queryWecomBotQr(scode: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<WecomQrQuery> {
  const body = await getJson(fetchImpl, `${QR_QUERY_URL}?scode=${encodeURIComponent(scode)}`)
  const data = (body.data ?? {}) as Record<string, unknown>
  const status = typeof data.status === 'string' ? data.status : ''
  if (status === 'success') {
    const info = (data.bot_info ?? {}) as Record<string, unknown>
    const botId = typeof info.botid === 'string' ? info.botid : ''
    const secret = typeof info.secret === 'string' ? info.secret : ''
    if (!botId || !secret) throw new Error('扫码成功，但未拿到机器人信息，请重新扫码')
    return { status: 'success', botId, secret }
  }
  return { status: 'waiting', detail: status }
}

interface QrSession {
  scode: string
  authUrl: string
  startedAt: number
  result: { botId: string; secret: string; at: number } | null
}

export type QrPollResult =
  | { status: 'waiting' }
  | { status: 'success'; bot_id: string }
  | { status: 'expired' }

export function createWecomQrSessions(options: { fetchImpl?: FetchLike; now?: () => number } = {}) {
  const sessions = new Map<string, QrSession>()
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike)
  const now = options.now ?? Date.now

  const prune = () => {
    const current = now()
    for (const [id, session] of sessions) {
      const expired = session.result
        ? current - session.result.at > RESULT_TTL_MS
        : current - session.startedAt > QR_SESSION_TTL_MS
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
      const { scode, authUrl } = await requestWecomBotQr(fetchImpl)
      const id = randomUUID()
      sessions.set(id, { scode, authUrl, startedAt: now(), result: null })
      return { session_id: id, qr_url: authUrl, expires_in: Math.round(QR_SESSION_TTL_MS / 1000) }
    },

    async poll(sessionId: string): Promise<QrPollResult> {
      prune()
      const session = sessions.get(sessionId)
      if (!session) return { status: 'expired' }
      if (session.result) return { status: 'success', bot_id: session.result.botId }
      const result = await queryWecomBotQr(session.scode, fetchImpl)
      if (result.status === 'success') {
        session.result = { botId: result.botId, secret: result.secret, at: now() }
        return { status: 'success', bot_id: result.botId }
      }
      return { status: 'waiting' }
    },

    /** Read scanned credentials without removing them (consume after the caller succeeds). */
    peek(sessionId: string): { botId: string; secret: string } | null {
      prune()
      const session = sessions.get(sessionId)
      return session?.result ? { botId: session.result.botId, secret: session.result.secret } : null
    },

    /** Hand the scanned credentials to the caller once; the session is removed. */
    consume(sessionId: string): { botId: string; secret: string } | null {
      prune()
      const session = sessions.get(sessionId)
      if (!session?.result) return null
      sessions.delete(sessionId)
      return { botId: session.result.botId, secret: session.result.secret }
    },
  }
}
