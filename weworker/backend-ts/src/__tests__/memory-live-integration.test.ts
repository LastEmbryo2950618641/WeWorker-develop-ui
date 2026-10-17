import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getSettings } from '../config.js'
import { buildAnthropicAuthHeaders } from '../anthropic-auth.js'
import { assembleContext } from '../context/context-assembler.js'
import { recallLongTermMemory } from '../context/long-term-context.js'
import { createRuntimeContext } from '../context/runtime-context.js'
import { createWorkContext } from '../context/work-context.js'
import { buildMemoryOutputProtocolPrompt, parseAssistantMemoryOutput } from '../memory/memory-extractor.js'
import { processMemoryEvent } from '../memory/memory-lifecycle.js'
import { MemoryStore } from '../memory/memory-store.js'

const runLive = process.env.WEWORKER_RUN_LIVE_MEMORY_TEST === '1'

describe.runIf(runLive)('真实模型跨会话记忆验收', () => {
  it('使用真实用户输入提取记忆，并在新会话中注入最终 SDK Prompt', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weworker-memory-live-'))
    const databaseFile = path.join(directory, 'memory.db')
    const scope = { user: 'live-memory-test-user' }
    let firstSession: MemoryStore | null = null
    let secondSession: MemoryStore | null = null

    try {
      const settings = getSettings()
      expect(settings.api_key, '当前 WeWorker 未配置模型 API Key').toBeTruthy()
      expect(settings.model, '当前 WeWorker 未配置模型').toBeTruthy()

      firstSession = new MemoryStore(new DatabaseSync(databaseFile))
      const response = await fetch(`${settings.base_url}/v1/messages`, {
        method: 'POST',
        headers: {
          ...buildAnthropicAuthHeaders(settings.api_key, settings.active_provider, settings.custom_auth_type),
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: settings.model,
          max_tokens: 800,
          system: `你是 WeWorker。\n\n${buildMemoryOutputProtocolPrompt({ scope })}`,
          messages: [{ role: 'user', content: '以后请默认使用中文回复我，回答尽量简洁。' }],
        }),
        signal: AbortSignal.timeout(20_000),
      })
      expect(response.ok).toBe(true)
      const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> }
      const assistantOutput = (payload.content ?? [])
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n')
      const parsed = parseAssistantMemoryOutput(assistantOutput)
      expect(parsed.decision?.candidate).toBeTruthy()
      const saved = await processMemoryEvent({
        eventId: 'live-cross-session-preference',
        scope,
        store: firstSession,
        candidate: parsed.decision!.candidate!,
      })
      expect(saved.status).toBe('saved')
      firstSession.close()
      firstSession = null

      secondSession = new MemoryStore(new DatabaseSync(databaseFile))
      const userMessage = '帮我看看今天有哪些待处理事项。'
      const longTerm = recallLongTermMemory({ query: userMessage, scope, store: secondSession })
      const assembled = assembleContext({
        runtime: createRuntimeContext({ systemPrompt: '你是 WeWorker。', identityPrompt: '' }),
        work: createWorkContext({ conversation: `User: ${userMessage}` }),
        longTerm,
        sdkSystemPrompt: '你是 WeWorker。',
        sdkPrompt: `User: ${userMessage}`,
      })

      expect(longTerm.recalled).not.toBe('')
      expect(assembled.sdk.system_prompt).toContain('[相关长期记忆]')
      expect(assembled.sdk.system_prompt).toMatch(/中文/u)
      expect(assembled.sdk.system_prompt).toMatch(/简洁/u)
    } finally {
      firstSession?.close()
      secondSession?.close()
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
