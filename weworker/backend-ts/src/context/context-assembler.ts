import { DEFAULT_CONTEXT_LIMIT } from '../context-window.js'
import type {
  ContextAssembly,
  ContextCategoryId,
  ContextCategorySnapshot,
  ConversationCompactionSnapshot,
  ContextSnapshot,
  LongTermMemoryContext,
  RuntimeContext,
  WorkContext,
} from './context-types.js'

const CJK_OR_FULL_WIDTH = /[\u2e80-\u9fff\uf900-\ufaff\uff01-\uff60]/u
const WHITESPACE = /\s/u

/** Deterministic local estimate for UI composition; billing usage stays separate from context size. */
export function estimateContextTokens(value: string): number {
  const text = String(value || '')
  if (!text) return 0

  let tokens = 0
  let latinRun = 0
  const flushLatin = () => {
    if (!latinRun) return
    tokens += Math.ceil(latinRun / 4)
    latinRun = 0
  }

  for (const char of text) {
    if (CJK_OR_FULL_WIDTH.test(char)) {
      flushLatin()
      tokens += 1
    } else if (WHITESPACE.test(char)) {
      flushLatin()
    } else if (/^[\p{L}\p{N}_-]$/u.test(char)) {
      latinRun += 1
    } else {
      flushLatin()
      tokens += 0.5
    }
  }
  flushLatin()
  return Math.ceil(tokens)
}

function category(id: ContextCategoryId, scope: ContextCategorySnapshot['scope'], text: string): ContextCategorySnapshot {
  return { id, scope, estimated_tokens: estimateContextTokens(text) }
}

function allocateCalibratedTokens(categories: ContextCategorySnapshot[], actualTotal: number): ContextCategorySnapshot[] {
  const estimatedTotal = categories.reduce((sum, item) => sum + item.estimated_tokens, 0)
  if (estimatedTotal <= 0) return categories.map((item) => ({ ...item, calibrated_tokens: 0 }))

  const allocations = categories.map((item, index) => {
    const exact = actualTotal * item.estimated_tokens / estimatedTotal
    return { index, exact, whole: Math.floor(exact), remainder: exact - Math.floor(exact) }
  })
  let remaining = actualTotal - allocations.reduce((sum, item) => sum + item.whole, 0)
  allocations.sort((left, right) => right.remainder - left.remainder || left.index - right.index)
  for (let index = 0; index < remaining; index += 1) allocations[index % allocations.length].whole += 1
  allocations.sort((left, right) => left.index - right.index)
  return categories.map((item, index) => ({ ...item, calibrated_tokens: allocations[index].whole }))
}

export function calibrateContextSnapshot(snapshot: ContextSnapshot, actualInputTokens?: number): ContextSnapshot {
  const actualTotal = Number(actualInputTokens)
  if (!Number.isFinite(actualTotal)) return snapshot
  const normalizedActualTotal = Math.max(0, Math.round(actualTotal))
  return {
    ...snapshot,
    actual_input_tokens: normalizedActualTotal,
    token_source: 'provider_calibrated',
    displayed_total_tokens: normalizedActualTotal,
    categories: allocateCalibratedTokens(snapshot.categories, normalizedActualTotal),
  }
}

function createSnapshot(
  runtime: RuntimeContext,
  work: WorkContext,
  longTerm: LongTermMemoryContext,
  contextLimit: number,
  compaction?: ConversationCompactionSnapshot,
): ContextSnapshot {
  const categories = [
    category('system_prompt', 'runtime', runtime.system_prompt),
    category('tool_definitions', 'runtime', runtime.tool_definitions),
    category('rules', 'runtime', runtime.rules),
    category('skills', 'runtime', runtime.skills),
    category('mcp_dynamic_tools', 'runtime', runtime.mcp_dynamic_tools),
    category('subagent_definitions', 'runtime', runtime.subagent_definitions),
    category('conversation', 'work', work.conversation),
    category('long_term_memory', 'long_term', longTerm.recalled),
  ]

  return {
    version: 1,
    phase: 'request_start',
    estimated_total_tokens: categories.reduce((sum, item) => sum + item.estimated_tokens, 0),
    context_limit: contextLimit,
    categories,
    token_source: 'estimated',
    displayed_total_tokens: categories.reduce((sum, item) => sum + item.estimated_tokens, 0),
    ...(compaction ? { compaction } : {}),
  }
}

export function assembleContext(input: {
  runtime: RuntimeContext
  work: WorkContext
  longTerm: LongTermMemoryContext
  sdkSystemPrompt: string
  sdkPrompt: string
  contextLimit?: number
  compaction?: ConversationCompactionSnapshot
}): ContextAssembly {
  const sdkSystemPrompt = input.longTerm.recalled
    ? `${input.sdkSystemPrompt}\n\n[相关长期记忆]\n${input.longTerm.recalled}`
    : input.sdkSystemPrompt
  return {
    runtime: input.runtime,
    work: input.work,
    long_term: input.longTerm,
    sdk: {
      system_prompt: sdkSystemPrompt,
      prompt: input.sdkPrompt,
    },
    snapshot: createSnapshot(
      input.runtime,
      input.work,
      input.longTerm,
      input.contextLimit ?? DEFAULT_CONTEXT_LIMIT,
      input.compaction,
    ),
  }
}

export function buildTurnEndContextSnapshot(
  requestSnapshot: ContextSnapshot,
  assistantTurnContext: string,
  actualInputTokens?: number,
): ContextSnapshot {
  const assistantTokens = estimateContextTokens(
    assistantTurnContext ? `\n\nAssistant: ${assistantTurnContext}` : '',
  )
  const categories = requestSnapshot.categories.map((item) => (
    item.id === 'conversation'
      ? { ...item, estimated_tokens: item.estimated_tokens + assistantTokens }
      : { ...item }
  ))
  const snapshot: ContextSnapshot = {
    ...requestSnapshot,
    phase: 'turn_end',
    estimated_total_tokens: categories.reduce((sum, item) => sum + item.estimated_tokens, 0),
    categories,
  }
  return calibrateContextSnapshot(snapshot, actualInputTokens)
}

export interface TurnContextEvent {
  type: string
  content?: string
  id?: string
  name?: string
  args?: unknown
  result?: string
  // Kept for event compatibility; normal query usage is billing data and is
  // intentionally ignored by the turn context collector.
  usage?: { total_input_tokens?: number }
}

export function createTurnContextCollector(requestSnapshot: ContextSnapshot) {
  let assistantText = ''
  const toolCalls = new Map<string, { name: string; result?: string }>()
  const skillTexts = new Map<string, string>()

  return {
    observe(event: TurnContextEvent): void {
      if (event.type === 'skill_context' && event.id && event.content) {
        skillTexts.set(event.id, event.content)
      } else if (event.type === 'text_delta' && event.content) {
        assistantText += event.content
      } else if (event.type === 'tool_call_start' && event.id) {
        const existing = toolCalls.get(event.id)
        toolCalls.set(event.id, { name: event.name || existing?.name || 'tool', result: existing?.result })
      } else if (event.type === 'tool_call_result' && event.id) {
        const existing = toolCalls.get(event.id) ?? { name: 'tool' }
        toolCalls.set(event.id, { ...existing, result: event.result })
      }
    },
    finish(): [
      { type: 'context_snapshot'; context: ContextSnapshot },
      { type: 'done' },
    ] {
      const toolText = [...toolCalls.values()]
        .map((tool) => `\n[Tool] ${tool.name}${tool.result ? `\n${tool.result}` : ''}`)
        .join('')
      const skillTokens = [...skillTexts.values()].reduce((sum, text) => sum + estimateContextTokens(text), 0)
      const snapshot = {
        ...requestSnapshot,
        estimated_total_tokens: requestSnapshot.estimated_total_tokens + skillTokens,
        categories: requestSnapshot.categories.map(item => item.id === 'skills'
          ? { ...item, estimated_tokens: item.estimated_tokens + skillTokens }
          : item),
      }
      const context = buildTurnEndContextSnapshot(
        snapshot,
        `${assistantText}${toolText}`,
      )
      return [
        { type: 'context_snapshot', context },
        { type: 'done' },
      ]
    },
  }
}
