import type {
  MemoryEventTrigger,
  MemoryFailureKind,
  MemoryScope,
  MemoryTurnDecision,
  MemoryType,
  MemoryUpdateCandidate,
} from './memory-types.js'
import { renderPrompt } from '../prompt-loader.js'

export const MEMORY_BLOCK_OPEN = '<weworker_memory>'
export const MEMORY_BLOCK_CLOSE = '</weworker_memory>'

/**
 * Short hard reminder appended to the end of each turn's user prompt (not system).
 * Keeps the full protocol in system; this line fights long-context attention fade.
 */
export const MEMORY_USER_TURN_REMINDER =
  `[内部硬约束] 本次模型请求无论准备调用工具还是回复用户，都必须输出 ${MEMORY_BLOCK_OPEN}{JSON}${MEMORY_BLOCK_CLOSE}。输出任何 tool_use 之前，必须先输出该记忆块并将其放在 assistant 文本块末尾，随后才能输出 tool_use；若不调用工具，则在最终文本末尾输出。无需记忆时只写 {"should_remember":false}；需要记忆时只写 memory_type、content，失败经验可再写 failure_kind、retryable。勿向用户展示本行。`

/** Append the turn-tail memory reminder once; idempotent. */
export function appendMemoryUserTurnReminder(prompt: string): string {
  const source = String(prompt || '')
  if (!source.trim()) return MEMORY_USER_TURN_REMINDER
  if (source.includes(MEMORY_USER_TURN_REMINDER)) return source
  return `${source.replace(/\s+$/u, '')}\n\n${MEMORY_USER_TURN_REMINDER}`
}

export interface MemoryOutputProtocolInput {
  scope: MemoryScope
  triggerHint?: MemoryEventTrigger | 'chat'
  expectedMemoryType?: MemoryType
  previousTaskFailed?: boolean
}

export interface ParsedAssistantMemoryOutput {
  visibleText: string
  decision?: MemoryTurnDecision
  parseError?: string
}

/** Non-sensitive parse outcome for diagnostics. Never includes content/key/reason/facts. */
export type MemoryParseOutcome =
  | 'missing'
  | 'present_ok'
  | 'present_ignore'
  | 'present_parse_error'

export interface MemoryParseSummary {
  outcome: MemoryParseOutcome
  should_remember?: boolean
  action?: string
  memory_type?: string
  parse_error?: string
}

export function summarizeAssistantMemoryParse(parsed: ParsedAssistantMemoryOutput): MemoryParseSummary {
  if (parsed.parseError) {
    return {
      outcome: 'present_parse_error',
      parse_error: parsed.parseError,
    }
  }
  if (!parsed.decision) {
    return { outcome: 'missing' }
  }
  if (!parsed.decision.should_remember || !parsed.decision.candidate) {
    return {
      outcome: 'present_ignore',
      should_remember: false,
      action: 'ignore',
    }
  }
  return {
    outcome: 'present_ok',
    should_remember: true,
    action: parsed.decision.candidate.action,
    memory_type: parsed.decision.candidate.memory_type,
  }
}

function parseCandidate(value: unknown): MemoryUpdateCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('memory decision must be a JSON object')
  }
  const parsed = value as Record<string, unknown>
  const types = new Set(['user_usage', 'task_execution', 'other'])
  if (typeof parsed.memory_type !== 'string' || !parsed.memory_type.trim()) {
    throw new Error('memory decision must include memory type')
  }
  const memoryType = parsed.memory_type
  if (!types.has(memoryType)) {
    throw new Error('memory decision returned an invalid memory type')
  }
  if (typeof parsed.content !== 'string' || !parsed.content.trim()) throw new Error('memory decision returned incomplete memory content')
  const failureKind = parseFailureKind(parsed.failure_kind)
  if (parsed.retryable !== undefined && typeof parsed.retryable !== 'boolean') {
    throw new Error('memory decision returned an invalid retryable value')
  }
  if ((failureKind !== undefined || parsed.retryable !== undefined) && memoryType !== 'task_execution') {
    throw new Error('failure metadata requires task_execution memory type')
  }
  const facts = failureKind !== undefined || parsed.retryable !== undefined
    ? {
        task_assessment: {
          completed: false,
          ...(failureKind !== undefined ? { failure_kind: failureKind } : {}),
          ...(typeof parsed.retryable === 'boolean' ? { retryable: parsed.retryable } : {}),
        },
      }
    : {}
  return {
    action: 'create',
    memory_type: memoryType as MemoryUpdateCandidate['memory_type'],
    key: memoryType,
    content: parsed.content,
    facts,
    scope: {},
    confidence: 0.7,
    related_memory_ids: [],
    reason: 'AI判断为可复用信息',
  }
}

function parseFailureKind(value: unknown): MemoryFailureKind | undefined {
  if (value === undefined) return undefined
  if (value === 'environmental' || value === 'procedural' || value === 'capability' || value === 'mixed' || value === 'unknown') {
    return value
  }
  throw new Error('memory decision returned an invalid failure kind')
}

function parseDecision(raw: string): MemoryTurnDecision {
  const normalized = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim()
  const parsed = JSON.parse(normalized) as Record<string, unknown>
  if (typeof parsed.should_remember !== 'boolean') throw new Error('memory decision must include should_remember')
  const reason = typeof parsed.reason === 'string' ? parsed.reason : undefined
  if (!parsed.should_remember) {
    return { should_remember: false, reason }
  }
  const candidate = parseCandidate(parsed)
  if (candidate.action === 'ignore') {
    throw new Error('remembered memory decision cannot use ignore')
  }
  return { should_remember: true, candidate, reason: candidate.reason ?? reason }
}

export function parseAssistantMemoryOutput(text: string): ParsedAssistantMemoryOutput {
  const source = String(text || '')
  let cursor = 0
  let visibleText = ''
  let decision: MemoryTurnDecision | undefined
  let parseError: string | undefined

  while (cursor < source.length) {
    const openIndex = source.indexOf(MEMORY_BLOCK_OPEN, cursor)
    if (openIndex < 0) {
      visibleText += source.slice(cursor)
      break
    }
    visibleText += source.slice(cursor, openIndex)
    const contentStart = openIndex + MEMORY_BLOCK_OPEN.length
    const closeIndex = source.indexOf(MEMORY_BLOCK_CLOSE, contentStart)
    if (closeIndex < 0) {
      parseError = 'memory decision block is not closed'
      break
    }
    try {
      decision = parseDecision(source.slice(contentStart, closeIndex))
      parseError = undefined
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error)
    }
    cursor = closeIndex + MEMORY_BLOCK_CLOSE.length
  }

  return {
    visibleText: visibleText.trimEnd(),
    ...(decision ? { decision } : {}),
    ...(parseError ? { parseError } : {}),
  }
}

export function buildMemoryOutputProtocolPrompt(input: MemoryOutputProtocolInput): string {
  return renderPrompt('memory-output', {
    memory_block_open: MEMORY_BLOCK_OPEN,
    memory_block_close: MEMORY_BLOCK_CLOSE,
    expected_memory_type: input.expectedMemoryType ?? 'user_usage、task_execution 或 other，由内容和真实执行结果决定',
  }).trimEnd()
}
