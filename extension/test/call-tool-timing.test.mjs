import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// ③ 扩展内部耗时观测：只测记账本身（收到 call_tool → 交回结果/错误），
// 不改控制流、不打印参数或用户数据。
const serviceWorkerSource = fs.readFileSync(new URL('../background/service-worker.js', import.meta.url), 'utf8')

function loadCallToolTiming() {
  const start = serviceWorkerSource.indexOf('const callToolTimings = new Map()')
  assert.ok(start >= 0, 'missing callToolTimings')
  const end = serviceWorkerSource.indexOf('// ─── Trace 日志存储', start)
  assert.ok(end > start, 'missing end of call tool timing helpers')
  const source = serviceWorkerSource.slice(start, end)

  let now = 1_000
  const traces = []
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    traceLog: (traceID, message) => traces.push({ traceID, message }),
    Date: { now: () => now },
    Map,
    String,
  })
  vm.runInContext(`${source}\nthis.noteCallToolStart = noteCallToolStart; this.logCallToolTiming = logCallToolTiming;`, context)
  return {
    note: (msg) => context.noteCallToolStart(msg),
    log: (msg) => context.logCallToolTiming(msg),
    advance: (ms) => { now += ms },
    traces,
  }
}

test('records the extension-internal duration on a tool result', () => {
  const harness = loadCallToolTiming()
  harness.note({ type: 'call_tool', id: 'tool-1', traceID: 'trace-a', toolName: 'example.com.do_thing' })
  harness.advance(7_540)
  harness.log({ type: 'call_tool_result', id: 'tool-1' })

  assert.equal(harness.traces.length, 1)
  assert.equal(harness.traces[0].traceID, 'trace-a')
  assert.match(harness.traces[0].message, /call_tool 内部耗时 7540ms/)
  assert.match(harness.traces[0].message, /example\.com\.do_thing/)
})

test('records the duration for failures as well', () => {
  const harness = loadCallToolTiming()
  harness.note({ type: 'call_tool', id: 'tool-2', traceID: 'trace-b', toolName: 'example.com.write' })
  harness.advance(120)
  harness.log({ type: 'call_tool_error', id: 'tool-2' })

  assert.equal(harness.traces.length, 1)
  assert.match(harness.traces[0].message, /内部耗时 120ms/)
})

test('ignores unrelated messages and never logs the same call twice', () => {
  const harness = loadCallToolTiming()
  harness.note({ type: 'list_tools', id: 'tool-3', traceID: 'trace-c' })
  harness.log({ type: 'call_tool_result', id: 'tool-3' })
  assert.equal(harness.traces.length, 0)

  harness.note({ type: 'call_tool', id: 'tool-4', traceID: 'trace-d', toolName: 'example.com.read' })
  harness.advance(50)
  harness.log({ type: 'call_tool_result', id: 'tool-4' })
  harness.advance(50)
  harness.log({ type: 'call_tool_result', id: 'tool-4' })
  assert.equal(harness.traces.length, 1)
})

test('the helper does not keep unbounded state', () => {
  const harness = loadCallToolTiming()
  for (let i = 0; i < 200; i += 1) {
    harness.note({ type: 'call_tool', id: `tool-${i}`, traceID: `trace-${i}`, toolName: 'example.com.do' })
  }
  harness.log({ type: 'call_tool_result', id: 'tool-199' })
  assert.equal(harness.traces.length, 1)
  // 早期条目已被丢弃：不会为 200 次调用累积内存。
  harness.log({ type: 'call_tool_result', id: 'tool-0' })
  assert.equal(harness.traces.length, 1)
})
