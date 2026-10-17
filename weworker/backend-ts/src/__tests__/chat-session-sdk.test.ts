import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { ChatSession, PromptQueue } from '../chat-session.js'
import { spawnManagedClaudeCodeProcess } from '../claude-process.js'

/** Delay in ms applied to every mock model call (see the `duration_api_ms` check below). */
const API_CALL_DELAY_MS = 120

// Real CLI, isolated configuration, local mock endpoint; no paid model calls.
it('keeps one real Claude process alive and refreshes MCP callbacks between turns', async () => {
  const requests: any[] = []
  const toolCalls: string[] = []
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk.toString()
    const request = JSON.parse(body || '{}')
    if (!req.url?.startsWith('/v1/messages')) { res.writeHead(404).end(); return }
    if (request.stream !== true) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ id: 'mock-title', type: 'message', role: 'assistant', model: 'test-model', content: [{ type: 'text', text: 'Test' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }))
      return
    }
    requests.push(request)
    // Slow every model call down so the CLI's API-duration ledger accumulates a
    // measurable, per-turn-distinguishable amount.
    await new Promise(resolve => setTimeout(resolve, API_CALL_DELAY_MS))
    res.setHeader('Content-Type', 'text/event-stream')
    const send = (type: string, event: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...event })}\n\n`)
    send('message_start', { message: { id: `mock-${requests.length}`, type: 'message', role: 'assistant', model: 'test-model', content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 0 } } })
    const hasToolResult = requests.length % 2 === 0
    if (hasToolResult) {
      send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'answer' } })
    } else {
      send('content_block_start', { index: 0, content_block: { type: 'tool_use', id: `tool-${requests.length}`, name: 'mcp__weworker__echo', input: {} } })
      send('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } })
    }
    send('content_block_stop', { index: 0 })
    send('message_delta', { delta: { stop_reason: hasToolResult ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 2 } })
    send('message_stop', {})
    res.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weworker-sdk-session-test-'))
  const port = (server.address() as import('node:net').AddressInfo).port
  const children: import('node:child_process').ChildProcess[] = []
  let currentTurn = 'initial'
  const mcp = createSdkMcpServer({ name: 'test-tools', tools: [tool('echo', 'Return current turn', {}, async () => {
    toolCalls.push(currentTurn)
    return { content: [{ type: 'text', text: currentTurn }] }
  })] })
  let session: ChatSession | undefined
  try {
    const cli = path.resolve(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
    expect(fs.existsSync(cli)).toBe(true)
    const queue = new PromptQueue()
    const handle = query({ prompt: queue, options: {
      pathToClaudeCodeExecutable: cli,
      model: 'test-model', systemPrompt: 'Test assistant', tools: [], settingSources: [],
      mcpServers: { weworker: mcp }, persistSession: false, includePartialMessages: true,
      permissionMode: 'default', canUseTool: async (_name, input) => ({ behavior: 'allow', updatedInput: input }), cwd: directory,
      env: { ...process.env, CLAUDE_CONFIG_DIR: directory, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
        ANTHROPIC_API_KEY: 'test-placeholder-key', ANTHROPIC_AUTH_TOKEN: '', CLAUDE_CODE_OAUTH_TOKEN: '',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDECODE: '' },
      spawnClaudeCodeProcess: args => {
        const child = spawnManagedClaudeCodeProcess(args)
        children.push(child)
        return child as any
      },
    } })
    session = new ChatSession({ workId: 'fixture-work', fingerprint: 'fixture', queue, query: handle,
      bindings: { workIdRef: { current: 'fixture-work' }, onAskUser: null, memory: { userPromptInjections: 0, postToolBatchInjections: 0 } } })
    const rawApiDurations: number[] = []
    const turnDurations: number[] = []
    // A live session owns the cross-turn baseline used to diff the CLI's
    // cumulative `duration_api_ms` (see agent.ts mapSdkMessage).
    expect(session.apiDuration.lastCumulativeMs).toBeNull()
    for (const prompt of ['first', 'second']) {
      const events = []
      currentTurn = prompt
      for await (const event of session.runTurn({ type: 'user', session_id: '', parent_tool_use_id: null, message: { role: 'user', content: prompt } })) events.push(event)
      session.complete([{ id: prompt, role: 'user' }])
      expect(events.some(event => event.type === 'result' && event.subtype === 'success')).toBe(true)
      const result = events.find(event => event.type === 'result') as any
      expect(result.usage.input_tokens).toBe(10)
      expect(result.usage.output_tokens).toBe(4)
      rawApiDurations.push(result.duration_api_ms)
      turnDurations.push(result.duration_ms)
    }
    // Ground truth for the `api=` metric: against the real CLI, the result field
    // `duration_api_ms` is the session-cumulative API duration (the same cost
    // ledger as total_cost_usd and modelUsage), so within one CLI process it
    // never shrinks, and by the second turn it already exceeds that turn's own
    // wall clock (`duration_ms`) because it also carries turn 1's model calls.
    // A per-turn field could not do that.
    expect(rawApiDurations.every(value => typeof value === 'number')).toBe(true)
    expect(rawApiDurations[1]).toBeGreaterThanOrEqual(rawApiDurations[0])
    expect(rawApiDurations[1]).toBeGreaterThan(turnDurations[1])
    expect(children).toHaveLength(1)
    expect(session.closed).toBe(false)
    expect(requests).toHaveLength(4)
    expect(toolCalls).toEqual(['first', 'second'])
    expect(JSON.stringify(requests[0].messages)).toContain('first')
    expect(JSON.stringify(requests[2].messages)).toContain('second')
    expect(requests[2].messages.filter((message: any) => message.role === 'user')).toHaveLength(3)
    const exited = new Promise<void>(resolve => children[0].once('exit', () => resolve()))
    session.close('test')
    await exited
    expect(session.closed).toBe(true)
    expect(() => process.kill(children[0].pid!, 0)).toThrow()
  } finally {
    session?.close('test')
    for (const child of children) child.kill()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    // The SDK may briefly hold transcript handles while its process exits on Windows.
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => child.once('exit', () => resolve()))
    }
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* Windows transcript shutdown can retain a temporary file handle. */ }
  }
}, 30_000)
