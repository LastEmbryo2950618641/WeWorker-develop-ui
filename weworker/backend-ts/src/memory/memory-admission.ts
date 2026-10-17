/**
 * Candidate-first memory admission.
 * Contract: prefer miss over wrong memory; never use NL fuzzy match to admit/deny.
 * Evidence tiers: provisional (declarative) | ledger (tool_use webcli extract) | verified (Bridge — not this phase).
 */
import type { MemoryAdapterIdentity, MemoryToolCall } from './memory-event-context.js'
import { isDeclarativeTaskExecution, parseExecutionRefs, type ExecutionRecordRow } from './execution-refs.js'
import type {
  MemoryFailureKind,
  MemoryScope,
  MemoryTaskAssessment,
  MemoryUpdateCandidate,
} from './memory-types.js'

export type MemoryVerification = 'provisional' | 'ledger' | 'verified'

export type MemoryAdmitReason =
  | 'admitted'
  | 'no_candidate'
  | 'ignore'
  | 'missing_site'
  | 'unknown_site'
  | 'disabled_site'
  | 'declarative_invalid'
  | 'execution_evidence_insufficient'
  | 'task_assessment_insufficient'
  | 'turn_failed'

export interface LedgerWebcliHit {
  tool: string
  adapterId: string
  ok: boolean
}

export interface MemoryAdmissionResult {
  ok: boolean
  reason: MemoryAdmitReason
  scope: MemoryScope
  verification?: MemoryVerification
  /** Candidate facts to merge before persist (adds verification). */
  factsPatch?: Record<string, unknown>
  confidenceCap?: number
}

const WEBCLI_CALL_RE = /webcli\s+call\s+([a-z0-9][a-z0-9_.-]*\.[a-z0-9_.-]+)/giu

function toolCommand(tool: MemoryToolCall): string {
  const args = tool.args
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ''
  const command = (args as Record<string, unknown>).command
  return typeof command === 'string' ? command : ''
}

/** Extract adapter.id.tool tokens from shell tool_use; ok follows shell status only. */
export function extractLedgerWebcliHits(toolCalls: MemoryToolCall[]): LedgerWebcliHit[] {
  const hits: LedgerWebcliHit[] = []
  for (const tool of toolCalls) {
    const name = String(tool.name || '')
    if (!/^(PowerShell|Bash)$/i.test(name)) continue
    const command = toolCommand(tool)
    if (!command) continue
    const ok = tool.status === 'done'
    WEBCLI_CALL_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = WEBCLI_CALL_RE.exec(command)) !== null) {
      const toolId = match[1]
      // support.example.com.my_todo → adapter support.example.com
      const parts = toolId.split('.')
      const adapterId = parts.length >= 3 ? parts.slice(0, -1).join('.') : toolId
      hits.push({ tool: toolId, adapterId, ok })
    }
  }
  return hits
}

function isKnownAdapter(site: string, adapters: MemoryAdapterIdentity[]): boolean {
  return adapters.some((a) => a.id === site)
}

function executionRefsMatchLedger(refs: ReturnType<typeof parseExecutionRefs>, hits: LedgerWebcliHit[]): boolean {
  const remaining = hits.slice()
  for (const ref of refs) {
    if (ref.kind !== 'webcli' || !ref.tool) continue
    const index = remaining.findIndex((hit) => hit.tool === ref.tool && (
      ref.required === 'any' || (ref.required === 'success' && hit.ok) || (ref.required === 'failed' && !hit.ok)
    ))
    if (index < 0) return false
    remaining.splice(index, 1)
  }
  return true
}

export function getTaskAssessment(candidate: MemoryUpdateCandidate): MemoryTaskAssessment | undefined {
  const raw = candidate.facts?.task_assessment
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const assessment = raw as unknown as Record<string, unknown>
  if (typeof assessment.completed !== 'boolean') return undefined
  if (assessment.recovered !== undefined && typeof assessment.recovered !== 'boolean') return undefined
  if (!isFailureKind(assessment.failure_kind)) return undefined
  if (assessment.retryable !== undefined && typeof assessment.retryable !== 'boolean') return undefined
  if (assessment.recovered === true && assessment.completed !== true) return undefined
  if (assessment.completed === false && assessment.failure_kind === undefined) return undefined
  if (assessment.subtasks !== undefined && (!Array.isArray(assessment.subtasks) || assessment.subtasks.some((subtask) => {
    if (!subtask || typeof subtask !== 'object' || Array.isArray(subtask)) return true
    const value = subtask as Record<string, unknown>
    if (typeof value.summary !== 'string' || !value.summary.trim() || typeof value.completed !== 'boolean') return true
    if (!isFailureKind(value.failure_kind)) return true
    if (value.retryable !== undefined && typeof value.retryable !== 'boolean') return true
    return value.completed === false && value.failure_kind === undefined
      || (value.reusable !== undefined && typeof value.reusable !== 'boolean')
  }))) return undefined
  return assessment as unknown as MemoryTaskAssessment
}

function isFailureKind(value: unknown): value is MemoryFailureKind | undefined {
  return value === undefined
    || value === 'environmental'
    || value === 'procedural'
    || value === 'capability'
    || value === 'mixed'
    || value === 'unknown'
}

export function hasTaskFailure(candidate: MemoryUpdateCandidate): boolean {
  const assessment = getTaskAssessment(candidate)
  return assessment !== undefined && !assessment.completed
}

/**
 * Admit a model memory candidate for persistence planning.
 * @param enabledAdapterIds when provided, site must be in this set (disabled → reject)
 */
export function admitMemoryCandidate(input: {
  candidate?: MemoryUpdateCandidate
  baseScope: MemoryScope
  adapters: MemoryAdapterIdentity[]
  enabledAdapterIds?: Set<string> | string[]
  toolCalls: MemoryToolCall[]
  turnSucceeded: boolean
  /** Optional ExecutionRecords; unused for verified until Bridge. */
  records?: ExecutionRecordRow[]
}): MemoryAdmissionResult {
  const candidate = input.candidate
  if (!candidate) return { ok: false, reason: 'no_candidate', scope: input.baseScope }
  if (candidate.action === 'ignore') return { ok: false, reason: 'ignore', scope: input.baseScope }

  const enabled = input.enabledAdapterIds
    ? (input.enabledAdapterIds instanceof Set
      ? input.enabledAdapterIds
      : new Set(input.enabledAdapterIds))
    : null

  if (candidate.memory_type === 'user_usage') {
    return {
      ok: true,
      reason: 'admitted',
      scope: { ...input.baseScope, ...(candidate.scope || {}) },
      verification: 'ledger',
      factsPatch: { verification: 'ledger' },
    }
  }

  if (candidate.memory_type === 'task_execution') {
    const assessment = getTaskAssessment(candidate)
    const scope = resolveTaskScope(candidate, input.baseScope, input.adapters, input.enabledAdapterIds)
    if (!scope.ok) return scope
    const refs = parseExecutionRefs(candidate.facts)
    const hasExecution = input.toolCalls.some((tool) => tool.status === 'done' || tool.status === 'failed')
    if (candidate.facts?.declarative === true) {
      if (!isDeclarativeTaskExecution({
        memoryType: candidate.memory_type,
        facts: candidate.facts,
        confidence: candidate.confidence,
        site: scope.scope.site,
      }) || refs.length > 0 || input.toolCalls.length > 0 || !input.turnSucceeded) {
        return { ok: false, reason: 'declarative_invalid', scope: scope.scope }
      }
      return {
        ok: true,
        reason: 'admitted',
        scope: scope.scope,
        verification: 'provisional',
        factsPatch: { verification: 'provisional', declarative: true },
        confidenceCap: 0.6,
      }
    }
    if (!hasExecution) return { ok: false, reason: 'execution_evidence_insufficient', scope: scope.scope }
    if (refs.length > 0 && !executionRefsMatchLedger(refs, extractLedgerWebcliHits(input.toolCalls))) {
      return { ok: false, reason: 'execution_evidence_insufficient', scope: scope.scope }
    }
    return {
      ok: true,
      reason: 'admitted',
      scope: scope.scope,
      verification: 'ledger',
      factsPatch: { verification: 'ledger' },
    }
  }

  if (candidate.memory_type === 'other') {
    // 项目契约：宁可漏记不可错记。`other` 不要求执行证据（那是 task_execution 专属规则），
    // 但只在本回合整体成功时准入，且始终按 provisional 记录、置信度封顶。
    if (!input.turnSucceeded) return { ok: false, reason: 'turn_failed', scope: input.baseScope }
    return {
      ok: true,
      reason: 'admitted',
      scope: { ...input.baseScope, ...(candidate.scope || {}) },
      verification: 'provisional',
      factsPatch: { verification: 'provisional' },
      confidenceCap: 0.6,
    }
  }

  if (candidate.memory_type.startsWith('extension:')) {
    const extension = candidate.scope?.extension || input.baseScope.extension
    if (!extension) return { ok: false, reason: 'missing_site', scope: input.baseScope }
    return {
      ok: true,
      reason: 'admitted',
      scope: { ...input.baseScope, extension },
      verification: 'provisional',
      factsPatch: { verification: 'provisional' },
      confidenceCap: 0.6,
    }
  }

  return { ok: false, reason: 'no_candidate', scope: input.baseScope }
}

function resolveTaskScope(
  candidate: MemoryUpdateCandidate,
  baseScope: MemoryScope,
  adapters: MemoryAdapterIdentity[],
  enabledAdapterIds?: Set<string> | string[],
): { ok: true; scope: MemoryScope } | { ok: false; reason: MemoryAdmitReason; scope: MemoryScope } {
  const site = String(candidate.scope?.site || '').trim()
  if (!site) return { ok: true, scope: { ...baseScope, ...(candidate.scope || {}) } }
  if (!isKnownAdapter(site, adapters)) return { ok: false, reason: 'unknown_site', scope: baseScope }
  const enabled = enabledAdapterIds instanceof Set ? enabledAdapterIds : enabledAdapterIds ? new Set(enabledAdapterIds) : null
  if (enabled && !enabled.has(site)) return { ok: false, reason: 'disabled_site', scope: { ...baseScope, site } }
  return { ok: true, scope: { ...baseScope, ...(candidate.scope || {}), site } }
}
