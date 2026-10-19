import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { query, type SDKUserMessage, type SpawnedProcess } from '@anthropic-ai/claude-agent-sdk'
import { ChatSession, PromptQueue } from '../chat-session.js'
import { spawnManagedClaudeCodeProcess } from '../claude-process.js'

// Opt-in real CLI test, entirely against a loopback fixture (no account or provider).
it.skipIf(process.env.WEWORKER_TEST_REAL_CLAUDE !== '1')('prewarms the real CLI without a model request and reuses its process', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weworker-claude-fixture-'))
  const requests: unknown[] = []
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    if (!req.url?.startsWith('/v1/messages')) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
      return
    }
    const parsed = JSON.parse(body)
    requests.push(parsed)
    const usage = { input_tokens: 20, output_tokens: 2 }
    const message = { id: `msg_fixture_${requests.length}`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'fixture reply' }], stop_reason: 'end_turn', stop_sequence: null, usage }
    if (!parsed.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(message))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const send = (event: Record<string, unknown>) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    send({ type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { ...usage, output_tokens: 0 } } })
    send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'fixture reply' } })
    send({ type: 'content_block_stop', index: 0 })
    send({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } })
    send({ type: 'message_stop' })
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const sessions: ChatSession[] = []
  const children: ReturnType<typeof spawnManagedClaudeCodeProcess>[] = []
  const start = () => {
    const queue = new PromptQueue()
    const env = { ...process.env }
    for (const key of Object.keys(env)) {
      if (/ANTHROPIC|CLAUDE|WEWORKER|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY/i.test(key)) delete env[key]
    }
    const config = path.join(root, `config-${sessions.length}`)
    fs.mkdirSync(config)
    fs.writeFileSync(path.join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }))
    const handle = query({ prompt: queue, options: {
      cwd: root, model: 'claude-sonnet-4-6', systemPrompt: 'Reply briefly.', tools: [], settingSources: [],
      env: { ...env, CLAUDE_CONFIG_DIR: config, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: 'test-only-placeholder', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      spawnClaudeCodeProcess(args) {
        const child = spawnManagedClaudeCodeProcess(args)
        children.push(child)
        return child as unknown as SpawnedProcess
      },
    } })
    const session = new ChatSession({ workId: 'fixture-work', fingerprint: 'fixture', queue, query: handle,
      bindings: { workIdRef: { current: 'fixture-work' }, onAskUser: null, memory: { userPromptInjections: 0, postToolBatchInjections: 0 } },
    })
    sessions.push(session)
    return session
  }
  const run = async (session: ChatSession, text: string) => {
    const began = performance.now()
    let result
    for await (const event of session.runTurn({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null } as SDKUserMessage)) {
      if (event.type === 'result') result = event
    }
    expect(result?.subtype).toBe('success')
    session.complete([{ id: text, role: 'user' }])
    return Math.round(performance.now() - began)
  }
  try {
    const coldStart = performance.now()
    const cold = start()
    await run(cold, 'cold fixture')
    const coldMs = Math.round(performance.now() - coldStart)
    cold.close('fixture_cold_complete')
    const requestCount = requests.length
    const warmStart = performance.now()
    const warm = start()
    await warm.ready()
    const initializationMs = Math.round(performance.now() - warmStart)
    expect(requests).toHaveLength(requestCount)
    const warmMs = await run(warm, 'warm fixture')
    const nextMs = await run(warm, 'second fixture')
    expect(children).toHaveLength(2)
    expect(requests).toHaveLength(requestCount + 2)
    console.info('CLAUDE_FIXTURE_TIMING', JSON.stringify({ coldMs, initializationMs, warmMs, nextMs, processes: children.length, requests: requests.length }))
  } finally {
    sessions.forEach(session => session.close('fixture_cleanup'))
    await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit')))
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}, 60_000)
