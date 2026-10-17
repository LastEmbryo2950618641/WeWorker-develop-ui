/**
 * Ask the Backend to start the Claude Code process while the user is typing,
 * so the first message of a conversation skips the CLI startup (several
 * seconds). Requests are throttled per target; the Backend ignores a warm-up
 * when a session already exists.
 */
import { normalizeThinkingEffort, THINKING_EFFORT_STORAGE_KEY } from './thinking-effort.js'

export const CHAT_WARMUP_INTERVAL_MS = 60_000
export const WELCOME_WARMUP_TARGET = 'welcome'

/** Text change that should trigger a warm-up: an empty composer starts a chat message. */
export function shouldWarmupOnTextChange(previousText, nextText) {
  const next = String(nextText || '').trimStart()
  if (!next) return false
  // `!command` runs a local shell command, not a model turn.
  if (next.startsWith('!')) return false
  return !String(previousText || '').trim()
}

/** 默认存储：浏览器里是 localStorage，Node 测试环境里为 null。 */
function defaultStorage() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

/**
 * 读取输入框持久化的思考强度。预热会话的配置指纹包含 thinkingEffort，
 * 取值不一致会让预热好的 CLI 在首条消息时被丢弃（白启动一次）。
 */
export function readPersistedThinkingEffort(storage = defaultStorage()) {
  try {
    return normalizeThinkingEffort(storage ? storage.getItem(THINKING_EFFORT_STORAGE_KEY) : '')
  } catch {
    return 'off'
  }
}

/**
 * 打开/切换会话（进入某个 work 的聊天界面）时的预热请求。
 * `workId` 为空表示欢迎页，那里仍由首次输入触发，返回 null。
 */
export function buildOpenWarmupRequest(workId, storage = defaultStorage()) {
  if (!workId) return null
  return { workId, payload: { thinkingEffort: readPersistedThinkingEffort(storage) } }
}

export function createChatWarmupScheduler({ send, now = () => Date.now(), intervalMs = CHAT_WARMUP_INTERVAL_MS }) {
  const lastSent = new Map()
  return function requestChatWarmup(workId, payload = {}) {
    const key = workId || WELCOME_WARMUP_TARGET
    const at = now()
    const previous = lastSent.get(key)
    if (previous !== undefined && at - previous < intervalMs) return false
    lastSent.set(key, at)
    // Best effort: a failed warm-up only means the first turn starts cold.
    Promise.resolve()
      .then(() => send(workId || null, payload))
      .catch(() => {})
    return true
  }
}
