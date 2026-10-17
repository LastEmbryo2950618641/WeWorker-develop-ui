/**
 * Long-term memory capacity management.
 *
 * 每个记忆档位（user_usage / task_execution / other / extension）有独立的估算 token 预算。
 * 超预算时按产品契约处理：**先融合近重复，再淘汰低价值记录**；
 * 淘汰一律用 `setStatus(id, 'superseded')`（保留审计），绝不物理删除，也绝不把某一档清空。
 *
 * 本模块除 `enforceMemoryBudget` 外均为纯函数，便于单测。
 */
import type { MemoryBudgets } from '../config.js'
import type { MemoryRecord } from './memory-types.js'
import type { MemoryStore } from './memory-store.js'

/** 预算档位：`extension` 覆盖所有 `extension:*` 记录。 */
export type MemoryBudgetKey = keyof MemoryBudgets

/** `enforceMemoryBudget` 需要的最小记录形状（纯函数用它，测试可传普通对象）。 */
export interface BudgetedMemory {
  id: string
  type: string
  key: string
  content: string
  confidence: number
  createdAt: string
  updatedAt: string
}

export interface MemoryBudgetUsage {
  /** 估算 token 用量 */
  tokens: number
  /** active 条数 */
  count: number
}

export interface MemoryConsolidationGroup {
  /** 组内价值最高、保留不动的记录 id */
  keep: string
  /** 组内其余需 supersede 的记录 id */
  supersede: string[]
}

export interface MemoryBudgetEnforcement {
  /** 执行前该档位估算 token 用量 */
  before: number
  /** 执行后该档位估算 token 用量 */
  after: number
  /** 融合阶段被 supersede 的 id */
  consolidated: string[]
  /** 淘汰阶段被 supersede 的 id */
  evicted: string[]
}

const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/u
const ASCII_TOKEN_PATTERN = /[a-z0-9]+/gu
const CJK_RUN_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]+/gu
/** 非 CJK 字符的估算密度：约 3.5 个字符 1 token。 */
const CHARS_PER_TOKEN = 3.5
/** 新鲜度半衰参考期：30 天后价值减半。 */
const FRESHNESS_HALF_LIFE_DAYS = 30
const MS_PER_DAY = 86_400_000
const DEFAULT_CONSOLIDATION_THRESHOLD = 0.8

/** 能力管理读取上限保护：单档位最多扫描的记录数（防止异常膨胀拖慢写入）。 */
const MAX_SCANNED_RECORDS = 5_000

/**
 * 估算一段文本占用的 token：CJK 字符按 1 token/字，其余字符按 3.5 字符/token，向上取整。
 * 空串返回 0，非空文本最小 1。
 */
export function estimateMemoryTokens(text: string): number {
  const source = String(text ?? '')
  if (!source) return 0
  let cjk = 0
  let rest = 0
  for (const char of source) {
    if (CJK_PATTERN.test(char)) cjk += 1
    else rest += 1
  }
  return Math.max(1, Math.ceil(cjk + rest / CHARS_PER_TOKEN))
}

/**
 * 记忆价值 = confidence × freshness。
 * freshness = 1 / (1 + ageDays / 30)，ageDays 取 updatedAt（缺失/非法时回退 createdAt）到 now 的天数，
 * 负数（记录时间在未来）按 0 处理。confidence 缺失或非法按 0 处理，并夹到 0~1。
 */
export function memoryValue(
  record: { confidence: number; createdAt: string; updatedAt: string },
  now: Date = new Date(),
): number {
  const confidence = Number.isFinite(record.confidence)
    ? Math.min(1, Math.max(0, record.confidence))
    : 0
  const stamp = record.updatedAt || record.createdAt || ''
  const parsed = Date.parse(stamp)
  const ageDays = Number.isFinite(parsed)
    ? Math.max(0, (now.getTime() - parsed) / MS_PER_DAY)
    : 0
  const freshness = 1 / (1 + ageDays / FRESHNESS_HALF_LIFE_DAYS)
  return confidence * freshness
}

/** 归一化（去空白、转小写）后取 token 集合：ASCII 词 + CJK 二元组（单字 run 取自身）。 */
function similarityTokens(value: string): Set<string> {
  const normalized = String(value ?? '')
    .toLocaleLowerCase()
    .replace(/\s+/gu, '')
  const tokens = new Set<string>()
  for (const match of normalized.matchAll(ASCII_TOKEN_PATTERN)) tokens.add(match[0])
  for (const match of normalized.matchAll(CJK_RUN_PATTERN)) {
    const run = match[0]
    if (run.length === 1) {
      tokens.add(run)
      continue
    }
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.add(run.slice(index, index + 2))
    }
  }
  return tokens
}

/**
 * 文本相似度：归一化后 token 集合的 Jaccard 相似度，范围 0~1。
 * 任一侧没有 token（空串或纯标点）时返回 0，避免把空记录判为近重复。
 */
export function memorySimilarity(a: string, b: string): number {
  const left = similarityTokens(a)
  const right = similarityTokens(b)
  if (!left.size || !right.size) return 0
  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection += 1
  }
  return intersection / (left.size + right.size - intersection)
}

/**
 * 找出近重复组：按 `key + content` 计算相似度，每组保留价值最高的一条，其余为待 supersede 的 id。
 * 纯函数；只返回存在待合并成员的组。
 */
export function selectMemoriesToConsolidate(
  records: BudgetedMemory[],
  options: { threshold?: number; now?: Date } = {},
): MemoryConsolidationGroup[] {
  const rawThreshold = options.threshold
  const threshold = Number.isFinite(rawThreshold)
    ? Math.min(1, Math.max(0, rawThreshold as number))
    : DEFAULT_CONSOLIDATION_THRESHOLD
  const now = options.now ?? new Date()
  const ordered = records
    .map((record, index) => ({ record, index, value: memoryValue(record, now) }))
    // 价值降序确定“保留者”；同价值时保持输入顺序，结果可复现。
    .sort((a, b) => b.value - a.value || a.index - b.index)

  const groups: Array<{ keep: string; text: string; supersede: string[] }> = []
  for (const { record } of ordered) {
    const text = `${record.key} ${record.content}`
    const group = groups.find((candidate) => memorySimilarity(candidate.text, text) >= threshold)
    if (group) group.supersede.push(record.id)
    else groups.push({ keep: record.id, text, supersede: [] })
  }
  return groups
    .filter((group) => group.supersede.length > 0)
    .map((group) => ({ keep: group.keep, supersede: group.supersede }))
}

/** 把具体记忆类型归到预算档位；未知类型返回 undefined。 */
export function resolveMemoryBudgetKey(type: string | undefined): MemoryBudgetKey | undefined {
  if (type === 'user_usage' || type === 'task_execution' || type === 'other') return type
  if (typeof type === 'string' && type.startsWith('extension:')) return 'extension'
  return undefined
}

function toBudgetedMemory(record: MemoryRecord): BudgetedMemory {
  return {
    id: record.id,
    type: record.type,
    key: record.key,
    content: record.content,
    confidence: record.confidence,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/**
 * 读取该档位的全部 active 记录。
 * 优先使用 MemoryStore.listActiveAll()（容量管理需要全量，公共召回 API 有 20 条上限）；
 * 传入自定义 store 实现时回退到 listActive 组合。
 */
function listBucketRecords(store: MemoryStore, type: MemoryBudgetKey): BudgetedMemory[] {
  const extended = store as MemoryStore & { listActiveAll?: () => MemoryRecord[] }
  const all = typeof extended.listActiveAll === 'function'
    ? extended.listActiveAll()
    : store.listActive({ limit: 20 })
  return all
    .filter((record) => resolveMemoryBudgetKey(record.type) === type)
    .slice(0, MAX_SCANNED_RECORDS)
    .map(toBudgetedMemory)
}

function sumTokens(records: BudgetedMemory[]): number {
  let total = 0
  for (const record of records) total += estimateMemoryTokens(record.key + record.content)
  return total
}

/** 某档位当前用量（估算 token + active 条数）。 */
export function memoryBucketUsage(store: MemoryStore, type: MemoryBudgetKey): MemoryBudgetUsage {
  const records = listBucketRecords(store, type)
  return { tokens: sumTokens(records), count: records.length }
}

/** 四个档位的当前用量，供 Renderer 的设置页展示。 */
export function summarizeMemoryBudgetUsage(store: MemoryStore): Record<MemoryBudgetKey, MemoryBudgetUsage> {
  return {
    user_usage: memoryBucketUsage(store, 'user_usage'),
    task_execution: memoryBucketUsage(store, 'task_execution'),
    other: memoryBucketUsage(store, 'other'),
    extension: memoryBucketUsage(store, 'extension'),
  }
}

/**
 * 把某档位压回预算内。
 * 顺序固定：① 融合近重复（保留价值最高的一条）→ ② 仍超预算时按价值升序淘汰。
 * 淘汰阶段至少保留 1 条，因此预算为 0 时该档位会被压缩到 1 条而不是清空。
 * 未超预算时不做任何写操作。
 */
export function enforceMemoryBudget(
  store: MemoryStore,
  type: MemoryBudgetKey,
  budget: number,
  opts: { now?: Date; threshold?: number } = {},
): MemoryBudgetEnforcement {
  const limit = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0
  const now = opts.now ?? new Date()
  const records = listBucketRecords(store, type)
  const before = sumTokens(records)
  if (before <= limit) {
    return { before, after: before, consolidated: [], evicted: [] }
  }

  // ① 融合：同一近重复组只保留价值最高的记录。
  const consolidated: string[] = []
  for (const group of selectMemoriesToConsolidate(records, { threshold: opts.threshold, now })) {
    for (const id of group.supersede) {
      store.setStatus(id, 'superseded')
      consolidated.push(id)
    }
  }

  // ② 淘汰：价值升序（同价值取更早更新者）逐个 supersede，直到回到预算内。
  const superseded = new Set(consolidated)
  let remaining = records.filter((record) => !superseded.has(record.id))
  let used = sumTokens(remaining)
  const evicted: string[] = []
  if (used > limit) {
    const order = [...remaining].sort((a, b) => memoryValue(a, now) - memoryValue(b, now)
      || a.updatedAt.localeCompare(b.updatedAt)
      || a.id.localeCompare(b.id))
    for (const record of order) {
      if (used <= limit || remaining.length <= 1) break
      store.setStatus(record.id, 'superseded')
      evicted.push(record.id)
      used -= estimateMemoryTokens(record.key + record.content)
      remaining = remaining.filter((candidate) => candidate.id !== record.id)
    }
  }

  return { before, after: used, consolidated, evicted }
}

/**
 * 按当前配置的预算执行容量管理，供对话路径（server.ts）与定时任务路径（task-executor.ts）共用。
 * `log` 只接收数量与用量，调用方不得把记忆正文写进日志。
 * 任何异常都被吞掉：容量管理绝不能影响记忆写入或上层响应。
 */
export function enforceConfiguredMemoryBudget(
  store: MemoryStore,
  memoryType: string | undefined,
  budgets: MemoryBudgets,
  log?: (payload: {
    type: MemoryBudgetKey
    before: number
    after: number
    consolidated: number
    evicted: number
  }) => void,
): void {
  try {
    const budgetType = resolveMemoryBudgetKey(memoryType)
    if (!budgetType) return
    const result = enforceMemoryBudget(store, budgetType, budgets[budgetType])
    log?.({
      type: budgetType,
      before: result.before,
      after: result.after,
      consolidated: result.consolidated.length,
      evicted: result.evicted.length,
    })
  } catch {
    // 容量管理失败不影响记忆写入与响应，调用方无需感知
  }
}
