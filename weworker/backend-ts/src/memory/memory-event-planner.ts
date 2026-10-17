import {
  buildMemoryEventContext,
  type MemoryAdapterIdentity,
  type MemoryToolCall,
} from './memory-event-context.js'
import { admitMemoryCandidate, getTaskAssessment } from './memory-admission.js'
import type { MemoryEventTrigger, MemoryScope, MemoryTaskAssessment, MemoryType, MemoryUpdateCandidate } from './memory-types.js'
import type { MemoryParseOutcome } from './memory-extractor.js'

export interface PlannedMemoryEvent {
  eventId: string
  trigger: MemoryEventTrigger
  scope: MemoryScope
  expectedMemoryType?: MemoryType
  /** Merged into candidate.facts before persist. */
  factsPatch?: Record<string, unknown>
  confidenceCap?: number
  admitReason?: string
}


/**
 * Resolve the memory candidate for a completed chat turn.
 * Model hidden block is the sole author; missing/ignore blocks never synthesize fallback content.
 */
export function resolveChatMemoryCandidate(input: {
  candidate?: MemoryUpdateCandidate
  parseOutcome?: MemoryParseOutcome
}): { candidate?: MemoryUpdateCandidate; source: 'model' | 'none' } {
  if (input.candidate) {
    if (input.candidate.action === 'ignore') {
      return { source: 'none' }
    }
    return { candidate: input.candidate, source: 'model' }
  }
  if (input.parseOutcome === 'present_ignore') {
    return { source: 'none' }
  }
  return { source: 'none' }
}

/**
 * Plan memory events using candidate-first admission (no NL fuzzy veto).
 */
export function planCompletedChatMemoryEvents(input: {
  baseEventId: string
  baseScope: MemoryScope
  userMessage: string
  adapters: MemoryAdapterIdentity[]
  enabledAdapterIds?: Set<string> | string[]
  toolCalls: MemoryToolCall[]
  turnSucceeded: boolean
  candidate?: MemoryUpdateCandidate
}): { scope: MemoryScope; events: PlannedMemoryEvent[]; admitReason?: string } {
  // Context retained for telemetry / recall hints only — not admission.
  const context = buildMemoryEventContext({
    baseScope: input.baseScope,
    userMessage: input.userMessage,
    adapters: input.adapters,
    toolCalls: input.toolCalls,
  })
  const candidate = input.candidate
  if (!candidate || candidate.action === 'ignore') {
    return { scope: context.scope, events: [], admitReason: 'ignore' }
  }

  const admission = admitMemoryCandidate({
    candidate,
    baseScope: input.baseScope,
    adapters: input.adapters,
    enabledAdapterIds: input.enabledAdapterIds,
    toolCalls: input.toolCalls,
    turnSucceeded: input.turnSucceeded,
  })
  if (!admission.ok) {
    return { scope: admission.scope, events: [], admitReason: admission.reason }
  }

  const scope = admission.scope
  const events: PlannedMemoryEvent[] = []
  const meta = {
    factsPatch: admission.factsPatch,
    confidenceCap: admission.confidenceCap,
    admitReason: admission.reason,
  }

  if (candidate.memory_type === 'user_usage') {
    events.push({
      eventId: `${input.baseEventId}:agent-user-usage`,
      trigger: 'agent_decision',
      scope,
      expectedMemoryType: 'user_usage',
      ...meta,
    })
  } else if (candidate.memory_type === 'task_execution') {
    const assessment = getTaskAssessment(candidate) ?? deriveTaskAssessment(input.toolCalls)
    const failed = assessment !== undefined && !assessment.completed
    const taskMeta = assessment && !getTaskAssessment(candidate)
      ? {
          ...meta,
          factsPatch: {
            ...(meta.factsPatch || {}),
            task_assessment: assessment,
          },
        }
      : meta
    const taskTrigger = candidate.facts?.declarative === true
      ? 'agent_decision'
      : assessment?.recovered === true
      ? 'task_recovered'
      : failed
        ? 'task_failed'
        : assessment?.completed === true
          ? 'task_completed'
          : 'agent_decision'
    events.push({
      eventId: taskTrigger === 'agent_decision'
        ? `${input.baseEventId}:agent-task-declarative`
        : `${input.baseEventId}:agent-task-${taskTrigger.replace('task_', '')}`,
      trigger: taskTrigger,
      scope,
      expectedMemoryType: 'task_execution',
      ...taskMeta,
    })
  } else if (candidate.memory_type === 'other') {
    // 用户明确要求记住、或不属于其他类别的稳定长期事实/约定。
    events.push({
      eventId: `${input.baseEventId}:agent-other`,
      trigger: 'agent_decision',
      scope,
      expectedMemoryType: 'other',
      ...meta,
    })
  } else if (candidate.memory_type.startsWith('extension:') && scope.extension) {
    events.push({
      eventId: `${input.baseEventId}:agent-extension`,
      trigger: 'agent_decision',
      scope,
      expectedMemoryType: candidate.memory_type,
      ...meta,
    })
  }

  return { scope, events, admitReason: admission.reason }
}

function deriveTaskAssessment(toolCalls: MemoryToolCall[]): MemoryTaskAssessment | undefined {
  const terminalCalls = toolCalls.filter((tool) => tool.status === 'done' || tool.status === 'failed')
  if (!terminalCalls.length) return undefined
  if (terminalCalls.some((tool) => tool.status === 'done')) return { completed: true }
  return { completed: false, failure_kind: 'unknown' }
}

export function planTaskMemoryEvent(input: {
  executionId: string
  trigger: Extract<MemoryEventTrigger, 'task_completed' | 'task_failed' | 'task_recovered'>
  baseScope: MemoryScope
  taskPrompt: string
  adapters: MemoryAdapterIdentity[]
  toolCalls: MemoryToolCall[]
}): { scope: MemoryScope; event: PlannedMemoryEvent } {
  const context = buildMemoryEventContext({
    baseScope: input.baseScope,
    userMessage: input.taskPrompt,
    adapters: input.adapters,
    toolCalls: input.toolCalls,
  })
  return {
    scope: context.scope,
    event: {
      eventId: `task:${input.executionId}:${input.trigger}`,
      trigger: input.trigger,
      scope: context.scope,
      expectedMemoryType: 'task_execution',
    },
  }
}

/** Apply admission patches onto a candidate before persist. */
export function applyAdmissionToCandidate(
  candidate: MemoryUpdateCandidate,
  event: PlannedMemoryEvent,
): MemoryUpdateCandidate {
  const facts = { ...(candidate.facts || {}), ...(event.factsPatch || {}) }
  let confidence = candidate.confidence
  if (typeof event.confidenceCap === 'number') {
    confidence = Math.min(confidence ?? event.confidenceCap, event.confidenceCap)
  }
  return {
    ...candidate,
    facts,
    confidence,
    scope: { ...(candidate.scope || {}), ...event.scope },
  }
}
