import { describe, expect, it } from 'vitest'
import {
  assembleContext,
  buildTurnEndContextSnapshot,
  calibrateContextSnapshot,
  createTurnContextCollector,
} from '../context/context-assembler.js'
import { createLongTermMemoryContext } from '../context/long-term-context.js'
import { createRuntimeContext } from '../context/runtime-context.js'
import { createWorkContext } from '../context/work-context.js'

describe('context providers', () => {
  it('assembles three independent providers without changing the SDK request', () => {
    const runtime = createRuntimeContext({
      systemPrompt: 'rules\nYou are WeWorker.',
      identityPrompt: 'You are WeWorker.',
      toolDefinitions: 'Read\nWrite',
      skillIndex: 'webcli: website operations',
      mcpDynamicTools: 'ask_user: request a choice',
    })
    const work = createWorkContext({ conversation: 'User: continue' })
    const longTerm = createLongTermMemoryContext({ recalledMemory: '' })

    const result = assembleContext({
      runtime,
      work,
      longTerm,
      sdkSystemPrompt: 'rules\nYou are WeWorker.',
      sdkPrompt: 'User: continue',
      contextLimit: 200_000,
    })

    expect(result.sdk).toEqual({
      system_prompt: 'rules\nYou are WeWorker.',
      prompt: 'User: continue',
    })
    expect(result.snapshot.phase).toBe('request_start')
    expect(result.snapshot.categories.map((category) => category.scope)).toContain('runtime')
    expect(result.snapshot.categories.map((category) => category.scope)).toContain('work')
    expect(result.snapshot.categories.map((category) => category.scope)).toContain('long_term')
  })

  it('creates a turn-end snapshot that includes this turn assistant context', () => {
    const start = assembleContext({
      runtime: createRuntimeContext({ systemPrompt: 'rules', identityPrompt: '' }),
      work: createWorkContext({ conversation: '你好' }),
      longTerm: createLongTermMemoryContext(),
      sdkSystemPrompt: 'rules',
      sdkPrompt: '你好',
      contextLimit: 1_000_000,
    }).snapshot
    const startConversation = start.categories.find((category) => category.id === 'conversation')!

    const end = buildTurnEndContextSnapshot(start, '你好，我已经完成当前回复。', 128)
    const endConversation = end.categories.find((category) => category.id === 'conversation')!

    expect(end.phase).toBe('turn_end')
    expect(end.actual_input_tokens).toBe(128)
    expect(endConversation.estimated_tokens).toBeGreaterThan(startConversation.estimated_tokens)
    expect(end.estimated_total_tokens).toBeGreaterThan(start.estimated_total_tokens)
    expect(start.phase).toBe('request_start')
  })

  it('calibrates category values to the provider total while preserving local proportions', () => {
    const start = assembleContext({
      runtime: createRuntimeContext({ systemPrompt: 'rules', identityPrompt: '' }),
      work: createWorkContext({ conversation: '当前任务' }),
      longTerm: createLongTermMemoryContext({ recalledMemory: '可复用长期经验' }),
      sdkSystemPrompt: 'rules',
      sdkPrompt: '当前任务',
    }).snapshot

    const calibrated = calibrateContextSnapshot(start, 101)
    const categoryTotal = calibrated.categories.reduce((sum, item) => sum + (item.calibrated_tokens ?? 0), 0)

    expect(calibrated.token_source).toBe('provider_calibrated')
    expect(calibrated.displayed_total_tokens).toBe(101)
    expect(calibrated.actual_input_tokens).toBe(101)
    expect(categoryTotal).toBe(101)
    expect(calibrated.categories.find((item) => item.id === 'long_term_memory')?.calibrated_tokens).toBeGreaterThan(0)
    expect(start.categories.every((item) => item.calibrated_tokens === undefined)).toBe(true)
  })

  it('collects one assistant turn and emits its end snapshot before done', () => {
    const start = assembleContext({
      runtime: createRuntimeContext({ systemPrompt: 'rules', identityPrompt: '' }),
      work: createWorkContext({ conversation: '执行查询' }),
      longTerm: createLongTermMemoryContext(),
      sdkSystemPrompt: 'rules',
      sdkPrompt: '执行查询',
    }).snapshot
    const collector = createTurnContextCollector(start)

    collector.observe({ type: 'text_delta', content: '正在处理。' })
    collector.observe({ type: 'tool_call_start', id: 'tool-1', name: 'Read', args: {} })
    collector.observe({ type: 'tool_call_start', id: 'tool-1', name: 'Read', args: { path: 'a.txt' } })
    collector.observe({ type: 'tool_call_result', id: 'tool-1', result: '完成' })
    collector.observe({ type: 'usage', usage: { total_input_tokens: 9999, context_input_tokens: 256 } })

    const events = collector.finish()

    expect(events.map((event) => event.type)).toEqual(['context_snapshot', 'done'])
    expect(events[0].context?.phase).toBe('turn_end')
    expect(events[0].context?.actual_input_tokens).toBe(256)
    expect(events[0].context?.estimated_total_tokens).toBeGreaterThan(start.estimated_total_tokens)
  })

  it('finishes an empty turn without mutating the request snapshot', () => {
    const start = assembleContext({
      runtime: createRuntimeContext({ systemPrompt: 'rules', identityPrompt: '' }),
      work: createWorkContext({ conversation: '停止' }),
      longTerm: createLongTermMemoryContext(),
      sdkSystemPrompt: 'rules',
      sdkPrompt: '停止',
    }).snapshot
    const startJson = JSON.stringify(start)

    const [end, done] = createTurnContextCollector(start).finish()

    expect(end.context.phase).toBe('turn_end')
    expect(end.context.actual_input_tokens).toBeUndefined()
    expect(end.context.estimated_total_tokens).toBe(start.estimated_total_tokens)
    expect(done.type).toBe('done')
    expect(JSON.stringify(start)).toBe(startJson)
  })

  it('counts a captured skill body once even when it also arrives as a tool result', () => {
    const start = assembleContext({
      runtime: createRuntimeContext({ systemPrompt: 'rules', identityPrompt: '' }),
      work: createWorkContext({ conversation: 'fixture question' }),
      longTerm: createLongTermMemoryContext(),
      sdkSystemPrompt: 'rules', sdkPrompt: 'fixture question',
    }).snapshot
    const skillOnly = createTurnContextCollector(start)
    const withToolResult = createTurnContextCollector(start)
    const content = 'fixture skill instructions '.repeat(30)
    skillOnly.observe({ type: 'skill_context', id: 'skill-1', content })
    withToolResult.observe({ type: 'tool_call_start', id: 'skill-1', name: 'Skill' })
    withToolResult.observe({ type: 'tool_call_result', id: 'skill-1', result: content })
    withToolResult.observe({ type: 'skill_context', id: 'skill-1', content })
    expect(withToolResult.finish()[0].context).toEqual(skillOnly.finish()[0].context)
  })
})
