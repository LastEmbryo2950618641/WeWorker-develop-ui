import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'

export interface WebcliCallOptions {
  host?: string
  port?: number
  timeoutMs?: number
  traceID?: string
  signal?: AbortSignal | null
  WebSocketImpl?: new (url: string) => WebSocketLike
}

export interface WebSocketLike {
  on(event: string, listener: (...args: any[]) => void): this
  once?(event: string, listener: (...args: any[]) => void): this
  off?(event: string, listener: (...args: any[]) => void): this
  send(data: string): void
  close(): void
  terminate?(): void
}

function messageText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return new TextDecoder().decode(value)
  return String(value ?? '')
}

/**
 * Call an Adapter through the already-running WebCLI Bridge.
 *
 * This is the same `call_tool` protocol used by `webcli call`, but it keeps the
 * request inside the Backend process so a model turn does not spawn a fresh
 * Node.js CLI process for every Adapter call.
 */
export function callWebcliTool(
  toolName: string,
  args: Record<string, unknown> = {},
  options: WebcliCallOptions = {},
): Promise<unknown> {
  const host = options.host ?? process.env.WEWORKER_WEBCLI_BRIDGE_HOST ?? '127.0.0.1'
  const port = options.port ?? Number(process.env.WEWORKER_WEBCLI_BRIDGE_PORT || 3711)
  const timeoutMs = options.timeoutMs ?? 120_000
  const id = `mcp-${randomUUID()}`
  const traceID = options.traceID ?? randomUUID().replaceAll('-', '').slice(0, 12)
  const Socket = options.WebSocketImpl ?? WebSocket

  return new Promise((resolve, reject) => {
    const socket = new Socket(`ws://${host}:${port}`)
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
    const close = () => {
      try { socket.close() } catch {}
    }
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      close()
      if (error) reject(error)
      else resolve(value)
    }
    const onAbort = () => finish(new Error('WebCLI call aborted.'))

    timer = setTimeout(() => finish(new Error(`WebCLI call timed out after ${timeoutMs}ms.`)), timeoutMs)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    socket.on('open', () => {
      try {
        socket.send(JSON.stringify({
          type: 'call_tool',
          toolName,
          args,
          id,
          traceID,
        }))
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
    socket.on('message', (data) => {
      let message: any
      try { message = JSON.parse(messageText(data)) } catch { return }
      if (message?.id !== id) return
      if (message.type === 'call_tool_result') finish(undefined, message.result)
      else if (message.type === 'call_tool_error') finish(new Error(String(message.error || 'WebCLI call failed.')))
    })
    socket.on('error', (error) => finish(error instanceof Error ? error : new Error(String(error))))
    socket.on('close', () => {
      if (!settled) finish(new Error('WebCLI Bridge connection closed.'))
    })
  })
}
