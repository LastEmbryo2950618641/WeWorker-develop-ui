import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { runServiceWorkerInContext } from './helpers/service-worker-test-loader.mjs'

// 稳定性回归：native WebSocket 收到「任何形状」的消息时，扩展的消息监听器都不得抛异常。
//
// 背景：MV3 service worker 里消息监听器一旦对普通消息（心跳 ack、未知类型）抛异常，
// worker 就会在下次事件时被重启并重连，Bridge 侧表现为高频「连接→断开→连接」。
// 这条测试把常见入站消息形状都喂给真实的监听器，证明它们都被安全吸收。
//
// 直接覆盖 ③ call_tool 耗时观测（`noteCallToolStart` / `logCallToolTiming`）的两个插入点：
// 起点在监听器里对*每条*消息执行（service-worker.js:2529），结算在 `sendToNative` 里
// 对*每条*出站消息执行（service-worker.js:3335）。

const ROOT = process.cwd()

function makeEvent() {
  const listeners = []
  return {
    addListener(listener) { listeners.push(listener) },
    listeners,
  }
}

async function loadServiceWorker() {
  const runtimeOnMessage = makeEvent()
  const nativeMessages = []
  const sockets = []
  const timers = []
  // 打开 WebSocket 的那一刻（模块求值期间）③ 的记账状态是否已经初始化。
  let probeAtConnect = null

  class FakeWebSocket {
    static OPEN = 1
    static CONNECTING = 0
    static CLOSING = 2
    static CLOSED = 3

    constructor() {
      this.readyState = FakeWebSocket.OPEN
      this.listeners = {}
      sockets.push(this)
      // TDZ 探针：消息监听器就是在这个构造函数之后注册的，所以只要此刻
      // `callToolTimings` 已初始化，:2529 的 `noteCallToolStart` 就不可能命中 TDZ。
      // （`typeof` 对处于 TDZ 的 let/const 会抛 ReferenceError，对已初始化值不会。）
      try {
        probeAtConnect = { ok: true, type: vm.runInContext('typeof callToolTimings', context) }
      } catch (err) {
        probeAtConnect = { ok: false, error: `${err.name}: ${err.message}` }
      }
    }

    addEventListener(type, listener) { this.listeners[type] = listener }
    send(data) { nativeMessages.push(JSON.parse(data)) }
    close() { this.readyState = FakeWebSocket.CLOSED }
  }

  const chrome = {
    action: { setBadgeText() {}, setBadgeBackgroundColor() {}, setTitle() {} },
    alarms: { create() {}, onAlarm: makeEvent() },
    debugger: { attach: async () => {}, detach: async () => {}, sendCommand: async () => ({}), onEvent: makeEvent(), onDetach: makeEvent() },
    downloads: { download: async () => 1 },
    runtime: { getManifest: () => ({ version: 'test' }), getURL: (path) => `chrome-extension://test/${path}`, lastError: null, onMessage: runtimeOnMessage, reload() {} },
    scripting: { executeScript: async () => {} },
    sidePanel: { setPanelBehavior() {} },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: {
      captureVisibleTab: async () => 'data:image/png;base64,',
      create: async ({ url }) => ({ id: 999, url, status: 'complete' }),
      get: async () => null,
      onRemoved: makeEvent(),
      onUpdated: makeEvent(),
      query(queryInfo, callback) {
        if (typeof callback === 'function') { callback([]); return undefined }
        return Promise.resolve([])
      },
      reload: async () => {},
      remove: async () => {},
      sendMessage: async () => ({ result: { ok: true } }),
      update: async (tabId) => ({ id: tabId }),
    },
    windows: { update: async () => ({}) },
  }

  const context = vm.createContext({
    Blob,
    Error,
    Map,
    Promise,
    Set,
    URL,
    WebSocket: FakeWebSocket,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    chrome,
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => ({ ok: false, json: async () => [], text: async () => '' }),
    // 定时器只记录、不执行：测试只关心消息路径本身，不被重连/心跳定时器干扰。
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimeout() {},
  })

  runServiceWorkerInContext(context, { repoRoot: ROOT })
  context.requestBridge = async () => null

  // 等模块启动期的异步初始化（adapter 列表 / 静态路由）落定，再清空出站记录，
  // 让断言只反映「本次投递」造成的出站流量。
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  nativeMessages.length = 0

  const socket = sockets[0]
  assert.ok(socket, 'service worker must open a native WebSocket connection')
  assert.equal(typeof socket.listeners.message, 'function', 'service worker must register a message listener')

  /**
   * 把一帧数据投递给真实的 message 监听器。
   * 返回 { status }：'ok'（正常返回）/ 'error'（抛了，err 附上）/ 'pending'
   * （在 `settleMs` 内没返回；call_tool 落到等标签页的分支时会这样，属于既有行为）。
   */
  const deliver = (data, settleMs = 250) => new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve({ status: 'pending' }) }
    }, settleMs)
    Promise.resolve()
      .then(() => socket.listeners.message({ data }))
      .then(
        () => { if (!settled) { settled = true; clearTimeout(timer); resolve({ status: 'ok' }) } },
        (err) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ status: 'error', err }) } },
      )
  })

  return {
    socket,
    context,
    nativeMessages,
    timers,
    probeAtConnect,
    deliver,
    deliverJson: (payload, settleMs) => deliver(JSON.stringify(payload), settleMs),
    /** 投递后回传可读结果，assert 失败时能直接看到形状与异常。 */
    safetyOf: async (data) => {
      const { status, err } = await deliver(data)
      return status === 'error' ? `threw ${err?.name}: ${err?.message}` : status
    },
  }
}

test('the timing state is initialized before the socket that delivers messages exists', async () => {
  const worker = await loadServiceWorker()
  // ★7 的头号嫌疑是 TDZ：如果 :2529 的起点在 `const callToolTimings` 之前就可能被调用，
  // 那么每条消息（含心跳）都会抛 ReferenceError → MV3 worker 被杀 → 重连风暴。
  // 这里证明 WebSocket（以及紧随其后的消息监听器）创建时该 const 已经初始化。
  assert.deepEqual(worker.probeAtConnect, { ok: true, type: 'object' })
})

test('every inbound message shape is absorbed without the listener throwing', async () => {
  const worker = await loadServiceWorker()
  const shapes = [
    ['heartbeat ack', { type: 'extension_hello_ack', capabilities: ['adapter_catalog_v1'] }],
    ['heartbeat ack without capabilities', { type: 'extension_hello_ack' }],
    ['heartbeat ack with junk capabilities', { type: 'extension_hello_ack', capabilities: 'not-an-array' }],
    ['unknown message type', { type: 'not_a_real_message_type', id: 'unknown-1' }],
    ['unknown message type without id', { type: 'another_unknown_type' }],
    ['empty object', {}],
    ['hello echo', { type: 'extension_hello', heartbeat: true }],
    ['list_tools', { type: 'list_tools', id: 'list-1' }],
    ['call_tool without toolName', { type: 'call_tool', id: 'call-1', traceID: 'trace-no-name' }],
    ['call_tool without id', { type: 'call_tool', toolName: 'example.com.do_thing' }],
    ['call_tool with unknown tool', { type: 'call_tool', id: 'call-2', traceID: 'trace-unknown', toolName: 'example.com.do_thing', args: {} }],
    ['outbound-shaped call_tool_result', { type: 'call_tool_result', id: 'call-3' }],
    ['outbound-shaped call_tool_error', { type: 'call_tool_error', id: 'call-4', error: 'x' }],
    ['bridge-internal result frame', { type: 'adapter_catalog_result', id: 'cat-1', ok: false }],
  ]

  for (const [label, payload] of shapes) {
    const outcome = await worker.safetyOf(JSON.stringify(payload))
    assert.notEqual(outcome, 'error', `message shape must not throw: ${label} (got ${outcome})`)
  }

  // 心跳是长期重复的：重复投递同样不能累积出异常。
  for (let i = 0; i < 25; i += 1) {
    assert.equal(await worker.safetyOf(JSON.stringify({ type: 'extension_hello_ack' })), 'ok', 'repeated heartbeat ack')
  }
  for (let i = 0; i < 25; i += 1) {
    assert.notEqual(await worker.safetyOf(JSON.stringify({ type: 'some_repeated_unknown', seq: i })), 'error', 'repeated unknown message')
  }
})

test('malformed frames are ignored instead of throwing', async () => {
  const worker = await loadServiceWorker()
  for (const frame of ['', '{', 'not json at all', '{"type":', '[', ']', 'null']) {
    const outcome = await worker.safetyOf(frame)
    assert.notEqual(outcome, 'error', `raw frame must be ignored: ${JSON.stringify(frame)} (got ${outcome})`)
  }
})

test('heartbeat and unknown messages produce no outbound traffic', async () => {
  const worker = await loadServiceWorker()
  await worker.deliverJson({ type: 'extension_hello_ack', capabilities: [] })
  await worker.deliverJson({ type: 'not_a_real_message_type', id: 'unknown-1' })
  await worker.deliverJson({ type: 'extension_hello', heartbeat: true })
  assert.deepEqual(worker.nativeMessages, [], 'the extension must not answer unknown messages')
})

test('call_tool timing bookkeeping runs on the message path and always drains', async () => {
  const worker = await loadServiceWorker()

  // 会**确定结算**的形状（路由阶段即失败），用来证明 ③ 的起点/结算都真的跑到了。
  worker.nativeMessages.length = 0
  const settled = await worker.deliverJson({ type: 'call_tool', id: 'call-fast', traceID: 'trace-fast', toolName: 'no_dot_tool_name' }, 2000)
  assert.equal(settled.status, 'ok', 'a call_tool that fails routing must be answered, not left hanging')
  assert.ok(
    worker.nativeMessages.some((msg) => msg.type === 'call_tool_error' || msg.type === 'call_tool_result'),
    'the failed call must still be answered on the normal path (guards against a vacuous test)',
  )

  // ③ 起点确实在消息路径上执行，③ 结算确实在 sendToNative 上执行（trace 里能看到内部耗时）。
  const traces = JSON.parse(vm.runInContext('JSON.stringify(getTraceLogs("trace-fast"))', worker.context))
  assert.ok(traces.some((line) => line.includes('call_tool 内部耗时')), `expected the internal timing trace, got: ${traces.join(' | ')}`)

  // 记账不泄漏：起点/结算一一对应后 Map 必然是空的。
  assert.equal(vm.runInContext('callToolTimings.size', worker.context), 0, 'the call tool timing map must drain')

  // 起点是**同步**记录的：消息监听器里的 noteCallToolStart 在任何 await 之前执行，
  // 所以还没等到路由结束，排队中的调用就已经可被结算（不会因为时序错位而漏记）。
  const pending = worker.socket.listeners.message({
    data: JSON.stringify({ type: 'call_tool', id: 'call-pending', traceID: 'trace-pending', toolName: 'example.com.do_thing', args: {} }),
  })
  assert.equal(vm.runInContext('callToolTimings.size', worker.context), 1, 'the timing start must be recorded synchronously on the message path')
  void Promise.resolve(pending).catch(() => {})
})
