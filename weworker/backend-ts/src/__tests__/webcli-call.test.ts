import { describe, expect, it } from 'vitest'
import { callWebcliTool } from '../webcli-call.js'

class FakeSocket {
  static instances: FakeSocket[] = []
  readonly sent: string[] = []
  private listeners = new Map<string, Array<(...args: any[]) => void>>()
  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }
  on(event: string, handler: (...args: any[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), handler])
    return this
  }
  once(event: string, handler: (...args: any[]) => void) {
    const wrapped = (...args: any[]) => {
      this.off(event, wrapped)
      handler(...args)
    }
    return this.on(event, wrapped)
  }
  off(event: string, handler: (...args: any[]) => void) {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((entry) => entry !== handler))
    return this
  }
  send(value: string) { this.sent.push(value) }
  close() { this.emit('close') }
  terminate() { this.emit('close') }
  emit(event: string, ...args: any[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

describe('in-process WebCLI Bridge client', () => {
  it('uses the existing call_tool protocol without spawning a CLI process', async () => {
    FakeSocket.instances = []
    const pending = callWebcliTool('demo.list', { limit: 2 }, {
      WebSocketImpl: FakeSocket as any,
      timeoutMs: 1000,
      traceID: 'trace-test',
    })
    const socket = FakeSocket.instances[0]
    expect(socket.url).toBe('ws://127.0.0.1:3711')
    socket.emit('open')
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: 'call_tool', toolName: 'demo.list', args: { limit: 2 }, traceID: 'trace-test',
    })
    socket.emit('message', JSON.stringify({
      type: 'call_tool_result', id: JSON.parse(socket.sent[0]).id, result: { rows: [1, 2] }, traceID: 'trace-test',
    }))
    await expect(pending).resolves.toEqual({ rows: [1, 2] })
  })

  it('propagates Bridge errors and closes the socket', async () => {
    FakeSocket.instances = []
    const pending = callWebcliTool('demo.write', {}, { WebSocketImpl: FakeSocket as any, timeoutMs: 1000 })
    const socket = FakeSocket.instances[0]
    socket.emit('open')
    const request = JSON.parse(socket.sent[0])
    socket.emit('message', JSON.stringify({ type: 'call_tool_error', id: request.id, error: 'confirmation required' }))
    await expect(pending).rejects.toThrow('confirmation required')
  })
})
