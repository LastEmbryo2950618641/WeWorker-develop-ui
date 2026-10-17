import { randomBytes, randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { assertAllowedWeixinBaseUrl } from '../channel-egress.js'

export type ProbeChannel = 'qq' | 'feishu' | 'wecom' | 'weixin'
type Config = Record<string, unknown>
type Check = { target: string; label: string; status: 'success' | 'failure' | 'skipped'; message: string; duration_ms?: number }
type Dependencies = {
  request?: typeof fetch
  allowedWeixinUrls?: Set<string>
  weixinUser?: { id: string; contextToken?: string }
  activeWecom?: { probeConnection(config: { bot_id: string; secret: string }): Promise<void> }
  subscribeWecom?: (botId: string, secret: string) => Promise<void>
}
export class ProbeError extends Error {}

export function probeExistingWecomSocket(socket: WebSocket, timeoutMs = 12_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) return reject(new ProbeError('企业微信尚未连接，请稍后重试'))
    const requestId = randomUUID()
    const finish = (error?: Error) => {
      clearTimeout(timer)
      socket.off('message', onMessage)
      socket.off('close', onClose)
      socket.off('error', onClose)
      error ? reject(error) : resolve()
    }
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const data = JSON.parse(raw.toString())
        if (data.headers?.req_id !== requestId) return
        finish(data.errcode === 0 ? undefined : new ProbeError('企业微信心跳验证失败'))
      } catch { /* Ignore unrelated frames. */ }
    }
    const onClose = () => finish(new ProbeError('企业微信连接已断开'))
    const timer = setTimeout(() => finish(new ProbeError('企业微信心跳检测超时')), timeoutMs)
    socket.on('message', onMessage)
    socket.on('close', onClose)
    socket.on('error', onClose)
    socket.send(JSON.stringify({ cmd: 'ping', headers: { req_id: requestId } }), error => {
      if (error) finish(new ProbeError('企业微信心跳发送失败'))
    })
  })
}

export function isProbeChannel(value: unknown): value is ProbeChannel {
  return typeof value === 'string' && ['qq', 'feishu', 'wecom', 'weixin'].includes(value)
}

export function resolveChannelProbeConfig(channel: ProbeChannel, draft: Config, saved: Config): Record<string, string> {
  const secret = channel === 'weixin' ? 'token' : channel === 'wecom' ? 'secret' : 'app_secret'
  const fields = channel === 'weixin' ? ['token', 'base_url'] : channel === 'wecom' ? ['bot_id', 'secret'] : ['app_id', 'app_secret']
  return Object.fromEntries(fields.map(key => {
    const value = draft[key] === undefined ? saved[key] : draft[key]
    if (value !== undefined && (typeof value !== 'string' || /[\r\n]/.test(value) || value.length > 8192)) {
      throw new ProbeError('配置格式无效，请检查输入')
    }
    const trimmed = (value as string | undefined)?.trim() || ''
    return [key, key === secret && !trimmed ? String(saved[key] || '') : trimmed]
  }))
}

// Used only when this process has no running WeCom connection. Never process messages.
export function probeWecomSubscription(botId: string, secret: string, url = 'wss://openws.work.weixin.qq.com', timeoutMs = 12_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { handshakeTimeout: timeoutMs, maxPayload: 1024 * 1024 })
    const requestId = randomUUID()
    let finished = false
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.on('error', () => {})
      socket.terminate()
      error ? reject(error) : resolve()
    }
    const timer = setTimeout(() => finish(new ProbeError('企业微信连接超时')), timeoutMs)
    socket.on('open', () => socket.send(JSON.stringify({ cmd: 'aibot_subscribe', headers: { req_id: requestId }, body: { bot_id: botId, secret } })))
    socket.on('message', raw => {
      try {
        const data = JSON.parse(raw.toString())
        if (data.headers?.req_id !== requestId) return
        if (data.errcode === 0) finish()
        else finish(new ProbeError('企业微信认证失败，请检查 BotID、Secret 和长连接 API 模式'))
      } catch { finish(new ProbeError('企业微信返回了无效响应')) }
    })
    socket.on('error', () => finish(new ProbeError('无法连接企业微信，请检查网络')))
    socket.on('close', () => finish(new ProbeError('企业微信连接已断开')))
  })
}

export async function probeChannel(channel: ProbeChannel, draft: Config, saved: Config, deps: Dependencies = {}) {
  const started = Date.now()
  const checks: Check[] = []
  let config: Record<string, string>
  try {
    config = resolveChannelProbeConfig(channel, draft, saved)
    const required = channel === 'weixin' ? ['token'] : channel === 'wecom' ? ['bot_id', 'secret'] : ['app_id', 'app_secret']
    if (required.some(key => !config[key])) throw new ProbeError(channel === 'weixin' ? '请填写 Token 或先扫码登录' : channel === 'wecom' ? '请填写 BotID 和 Secret' : '请填写 App ID 和 App Secret')
    if (channel === 'weixin') {
      try { config.base_url = assertAllowedWeixinBaseUrl(config.base_url, deps.allowedWeixinUrls) }
      catch { throw new ProbeError('微信服务地址无效或不在允许列表中') }
    }
    checks.push({ target: 'config', label: '配置检查', status: 'success', message: '必填信息完整' })
  } catch (error) {
    checks.push({ target: 'config', label: '配置检查', status: 'failure', message: error instanceof ProbeError ? error.message : '配置无效' })
    checks.push({ target: 'platform', label: '平台验证', status: 'skipped', message: '请先补全配置' })
    return { ok: false, checks, duration_ms: Date.now() - started }
  }
  const request = deps.request || fetch
  const signal = AbortSignal.timeout(15_000)
  const json = async (url: string, body?: object, headers: Record<string, string> = {}) => {
    const response = await request(url, { method: body ? 'POST' : 'GET', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
    if (!response.ok) throw new ProbeError(`平台请求失败（HTTP ${response.status}），请检查凭证、权限和网络`)
    let value
    try { value = await response.json() }
    catch { throw new ProbeError('平台返回了无效响应') }
    if (!value || typeof value !== 'object') throw new ProbeError('平台返回了无效响应')
    return value as Record<string, any>
  }
  const platformStarted = Date.now()
  try {
    let message: string
    if (channel === 'qq') {
      const token = await json('https://bots.qq.com/app/getAppAccessToken', { appId: config.app_id, clientSecret: config.app_secret })
      if (typeof token.access_token !== 'string' || !token.access_token) throw new ProbeError('QQ 凭证认证失败，请检查 App ID 和 App Secret')
      const gateway = await json('https://api.sgroup.qq.com/gateway/bot', undefined, { Authorization: `QQBot ${token.access_token}` })
      if (typeof gateway.url !== 'string' || !gateway.url.startsWith('wss://')) throw new ProbeError('QQ 网关不可用，请检查机器人状态和权限')
      message = 'QQ 凭证有效，机器人网关可访问；未测试消息收发'
    } else if (channel === 'feishu') {
      const token = await json('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', { app_id: config.app_id, app_secret: config.app_secret })
      if (token.code !== 0 || typeof token.tenant_access_token !== 'string' || !token.tenant_access_token) throw new ProbeError('飞书凭证认证失败，请检查 App ID 和 App Secret')
      const bot = await json('https://open.feishu.cn/open-apis/bot/v3/info', undefined, { Authorization: `Bearer ${token.tenant_access_token}` })
      if (bot.code !== 0 || !bot.bot?.open_id) throw new ProbeError('飞书机器人不可用，请检查机器人能力和发布状态')
      message = '飞书凭证有效，机器人信息可读取；未测试事件订阅与消息收发'
    } else if (channel === 'wecom') {
      if (deps.activeWecom) await deps.activeWecom.probeConnection({ bot_id: config.bot_id, secret: config.secret })
      else await (deps.subscribeWecom || probeWecomSubscription)(config.bot_id, config.secret)
      message = deps.activeWecom ? '企业微信现有连接心跳正常' : '企业微信订阅认证通过，临时检测连接已关闭'
    } else {
      if (!deps.weixinUser?.id) {
        checks.push({ target: 'platform', label: '微信平台验证', status: 'skipped', message: '请先在微信向机器人发送一条消息，再检测。此检测不读取待收消息，也不发送测试消息。' })
        return { ok: false, checks, duration_ms: Date.now() - started }
      }
      const data = await json(`${config.base_url}/ilink/bot/getconfig`, { ilink_user_id: deps.weixinUser.id, context_token: deps.weixinUser.contextToken, base_info: {} }, {
        Authorization: `Bearer ${config.token}`, AuthorizationType: 'ilink_bot_token',
        'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64'),
      })
      if ((data.ret !== undefined && data.ret !== 0) || (data.errcode !== undefined && data.errcode !== 0) || (data.ret !== 0 && data.errcode !== 0)) throw new ProbeError('微信凭证验证失败，请检查 Token 或重新扫码登录')
      message = '微信 Token 验证通过，配置接口可访问；未发送测试消息'
    }
    checks.push({ target: 'platform', label: '平台验证', status: 'success', message, duration_ms: Date.now() - platformStarted })
  } catch (error) {
    checks.push({ target: 'platform', label: '平台验证', status: 'failure', message: error instanceof ProbeError ? error.message : signal.aborted ? '检测超时，请检查网络后重试' : '平台验证失败，请检查凭证、连接状态和网络', duration_ms: Date.now() - platformStarted })
  }
  return { ok: checks.every(check => check.status === 'success'), checks, duration_ms: Date.now() - started }
}
