/** `other` = 用户明确要求记住、或不属于其他类别的稳定长期事实/约定。 */
export type MemoryType = 'user_usage' | 'task_execution' | 'other' | `extension:${string}`
export type MemoryStatus = 'active' | 'superseded' | 'invalid'
export type MemoryEventTrigger =
  | 'agent_decision'
  | 'task_completed'
  | 'task_failed'
  | 'task_recovered'

export interface MemoryScope {
  user?: string
  project?: string
  site?: string
  extension?: string
}

export interface MemoryRecord {
  id: string
  type: MemoryType
  key: string
  content: string
  facts: Record<string, unknown>
  scope: MemoryScope
  status: MemoryStatus
  confidence: number
  sourceWorkId?: string
  sourceMessageId?: string
  sourceEventId: string
  sourceVersion?: string
  lastVerifiedAt?: string
  createdAt: string
  updatedAt: string
}

export interface CreateMemoryInput {
  type: MemoryType
  key: string
  content: string
  facts?: Record<string, unknown>
  scope?: MemoryScope
  confidence?: number
  sourceWorkId?: string
  sourceMessageId?: string
  sourceEventId: string
  sourceVersion?: string
  lastVerifiedAt?: string
}

export interface MemorySearchInput {
  query: string
  scope?: MemoryScope
  limit?: number
}

export interface ActiveMemoryListInput {
  scope?: MemoryScope
  type?: MemoryType
  limit?: number
}

export type MemoryUpdateAction = 'create' | 'update' | 'merge' | 'supersede' | 'ignore'

export type MemoryFailureKind = 'environmental' | 'procedural' | 'capability' | 'mixed' | 'unknown'

export interface MemorySubtaskAssessment {
  summary: string
  completed: boolean
  reusable?: boolean
  failure_kind?: MemoryFailureKind
  retryable?: boolean
}

export interface MemoryTaskAssessment {
  completed: boolean
  recovered?: boolean
  subtasks?: MemorySubtaskAssessment[]
  failure_kind?: MemoryFailureKind
  retryable?: boolean
}

export interface MemoryUpdateCandidate {
  action: MemoryUpdateAction
  memory_type: MemoryType
  key: string
  content: string
  facts?: Record<string, unknown> & {
    task_assessment?: MemoryTaskAssessment
  }
  scope?: MemoryScope
  confidence?: number
  related_memory_ids?: string[]
  reason?: string
}

export interface MemoryTurnDecision {
  should_remember: boolean
  candidate?: MemoryUpdateCandidate
  reason?: string
}
