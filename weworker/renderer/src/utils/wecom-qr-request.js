import { backendFetch } from '../api/http.js'

export async function requestWecomQr(action, body, request = backendFetch) {
  return requestBotQr('wecom', action, body, request)
}

export async function requestBotQr(channel, action, body, request = backendFetch) {
  if (!['wecom', 'qq', 'feishu'].includes(channel) || !['start', 'poll', 'cancel'].includes(action)) throw new Error('不支持的扫码操作')
  const name = { wecom: '企业微信', qq: 'QQ', feishu: '飞书' }[channel]
  let res
  try {
    res = await request(`/settings/${channel}/qr-${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}), signal: AbortSignal.timeout(action === 'start' ? 30_000 : 20_000),
    })
  } catch (error) {
    throw new Error(error?.name === 'TimeoutError'
      ? '扫码请求超时，请稍后重试'
      : '无法连接 WeWorker 后端，请等待服务启动后重试')
  }
  if (res.status === 404) throw new Error('当前后端尚未加载扫码功能，请重启 WeWorker 后重试')
  if (res.status === 401 || res.status === 403) throw new Error('扫码请求认证失败，请重启 WeWorker 后重试')
  if (!res.ok) throw new Error(`${name}扫码服务请求失败（HTTP ${res.status}），请稍后重试`)
  try { return await res.json() }
  catch { throw new Error('扫码服务返回格式异常，请稍后重试') }
}
