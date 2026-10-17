import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { ActiveMemoryListInput, CreateMemoryInput, MemoryRecord, MemoryScope, MemorySearchInput, MemoryStatus, MemoryType } from './memory-types.js'
import { redactMemoryText } from './memory-safety.js'

const MEMORY_DB_DIR = path.join(os.homedir(), '.weworker')
const MEMORY_DB_FILE = path.join(MEMORY_DB_DIR, 'memory.db')

interface MemoryRow {
  id: string
  type: string
  key: string
  content: string
  facts_json: string
  user_scope: string | null
  project_scope: string | null
  site_scope: string | null
  extension_scope: string | null
  status: string
  confidence: number
  source_work_id: string | null
  source_message_id: string | null
  source_event_id: string
  source_version: string | null
  last_verified_at: string | null
  created_at: string
  updated_at: string
}

function rowToRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    type: row.type as MemoryType,
    key: row.key,
    content: row.content,
    facts: JSON.parse(row.facts_json || '{}') as Record<string, unknown>,
    scope: {
      ...(row.user_scope ? { user: row.user_scope } : {}),
      ...(row.project_scope ? { project: row.project_scope } : {}),
      ...(row.site_scope ? { site: row.site_scope } : {}),
      ...(row.extension_scope ? { extension: row.extension_scope } : {}),
    },
    status: row.status as MemoryStatus,
    confidence: row.confidence,
    sourceWorkId: row.source_work_id ?? undefined,
    sourceMessageId: row.source_message_id ?? undefined,
    sourceEventId: row.source_event_id,
    sourceVersion: row.source_version ?? undefined,
    lastVerifiedAt: row.last_verified_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function appendScopeFilter(
  clauses: string[],
  values: SQLInputValue[],
  column: string,
  value: string | undefined,
): void {
  if (value) {
    clauses.push(`(m.${column} IS NULL OR m.${column} = ?)`)
    values.push(value)
  } else {
    clauses.push(`m.${column} IS NULL`)
  }
}

function normalizeSearchText(value: string): string {
  return String(value || '')
    .replace(/["'*:^(){}\[\]\\.,;!?/|<>=+~#@`$%&-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function normalizeFtsQuery(value: string): string {
  const terms = normalizeSearchText(value)
    .split(' ')
    .filter((term) => [...term].length >= 3)
  return terms
    .map((term) => `"${term.replace(/"/gu, '""')}"`)
    .join(' OR ')
}

export class MemoryStore {
  private readonly database: DatabaseSync

  constructor(database?: DatabaseSync) {
    if (database) {
      this.database = database
    } else {
      fs.mkdirSync(MEMORY_DB_DIR, { recursive: true })
      this.database = new DatabaseSync(MEMORY_DB_FILE)
    }
    this.initialize()
  }

  private initialize(): void {
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        facts_json TEXT NOT NULL DEFAULT '{}',
        user_scope TEXT,
        project_scope TEXT,
        site_scope TEXT,
        extension_scope TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        confidence REAL NOT NULL DEFAULT 1,
        source_work_id TEXT,
        source_message_id TEXT,
        source_event_id TEXT NOT NULL UNIQUE,
        source_version TEXT,
        last_verified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_scope_status
        ON memories(status, user_scope, project_scope, site_scope, extension_scope);
      CREATE TABLE IF NOT EXISTS memory_events (
        event_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 1,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        memory_id UNINDEXED,
        key,
        content,
        facts_json,
        tokenize='trigram'
      );
    `)
  }

  create(input: CreateMemoryInput): MemoryRecord {
    const id = randomUUID()
    const now = new Date().toISOString()
    const factsJson = JSON.stringify(input.facts ?? {})
    const confidence = Math.min(1, Math.max(0, input.confidence ?? 1))
    const scope = input.scope ?? {}
    const transaction = this.database.prepare(`
      INSERT INTO memories (
        id, type, key, content, facts_json,
        user_scope, project_scope, site_scope, extension_scope,
        status, confidence, source_work_id, source_message_id, source_event_id,
        source_version, last_verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    this.database.exec('SAVEPOINT memory_create')
    try {
      transaction.run(
        id, input.type, input.key, input.content, factsJson,
        scope.user ?? null, scope.project ?? null, scope.site ?? null, scope.extension ?? null,
        confidence, input.sourceWorkId ?? null, input.sourceMessageId ?? null, input.sourceEventId,
        input.sourceVersion ?? null, input.lastVerifiedAt ?? null, now, now,
      )
      this.database.prepare(
        'INSERT INTO memory_fts (memory_id, key, content, facts_json) VALUES (?, ?, ?, ?)',
      ).run(id, input.key, input.content, factsJson)
      this.database.exec('RELEASE SAVEPOINT memory_create')
    } catch (error) {
      this.database.exec('ROLLBACK TO SAVEPOINT memory_create')
      this.database.exec('RELEASE SAVEPOINT memory_create')
      throw error
    }
    return this.get(id)!
  }

  get(id: string): MemoryRecord | null {
    const row = this.database.prepare('SELECT * FROM memories WHERE id = ?').get(id) as unknown as MemoryRow | undefined
    return row ? rowToRecord(row) : null
  }

  invalidate(id: string): void {
    this.database.prepare(
      "UPDATE memories SET status = 'invalid', updated_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), id)
  }

  setStatus(id: string, status: MemoryStatus): void {
    this.database.prepare(
      'UPDATE memories SET status = ?, updated_at = ? WHERE id = ?',
    ).run(status, new Date().toISOString(), id)
  }

  update(id: string, input: Pick<CreateMemoryInput, 'type' | 'key' | 'content' | 'facts' | 'scope' | 'confidence'>): MemoryRecord | null {
    const existing = this.get(id)
    if (!existing) return null
    const now = new Date().toISOString()
    const factsJson = JSON.stringify(input.facts ?? {})
    const scope = input.scope ?? {}
    const confidence = Math.min(1, Math.max(0, input.confidence ?? existing.confidence))
    this.database.exec('SAVEPOINT memory_update')
    try {
      this.database.prepare(`
        UPDATE memories SET
          type = ?, key = ?, content = ?, facts_json = ?,
          user_scope = ?, project_scope = ?, site_scope = ?, extension_scope = ?,
          confidence = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.type, input.key, input.content, factsJson,
        scope.user ?? null, scope.project ?? null, scope.site ?? null, scope.extension ?? null,
        confidence, now, id,
      )
      this.database.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(id)
      this.database.prepare(
        'INSERT INTO memory_fts (memory_id, key, content, facts_json) VALUES (?, ?, ?, ?)',
      ).run(id, input.key, input.content, factsJson)
      this.database.exec('RELEASE SAVEPOINT memory_update')
    } catch (error) {
      this.database.exec('ROLLBACK TO SAVEPOINT memory_update')
      this.database.exec('RELEASE SAVEPOINT memory_update')
      throw error
    }
    return this.get(id)
  }

  beginEvent(eventId: string): boolean {
    const now = new Date().toISOString()
    const inserted = this.database.prepare(`
      INSERT OR IGNORE INTO memory_events (event_id, status, attempts, created_at, updated_at)
      VALUES (?, 'processing', 1, ?, ?)
    `).run(eventId, now, now)
    if (Number(inserted.changes) > 0) return true
    const retried = this.database.prepare(`
      UPDATE memory_events
      SET status = 'processing', attempts = attempts + 1, last_error = NULL, updated_at = ?
      WHERE event_id = ? AND status = 'failed'
    `).run(now, eventId)
    return Number(retried.changes) > 0
  }

  completeEvent(eventId: string): void {
    this.database.prepare(
      "UPDATE memory_events SET status = 'completed', updated_at = ? WHERE event_id = ?",
    ).run(new Date().toISOString(), eventId)
  }

  completeEventAtomically<T>(eventId: string, apply: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = apply()
      const completed = this.database.prepare(
        "UPDATE memory_events SET status = 'completed', updated_at = ? WHERE event_id = ? AND status = 'processing'",
      ).run(new Date().toISOString(), eventId)
      if (Number(completed.changes) !== 1) throw new Error('memory event is not processing')
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  failEvent(eventId: string, error: string): void {
    this.database.prepare(
      "UPDATE memory_events SET status = 'failed', last_error = ?, updated_at = ? WHERE event_id = ?",
    ).run(redactMemoryText(String(error || '')).slice(0, 500), new Date().toISOString(), eventId)
  }

  search(input: MemorySearchInput): MemoryRecord[] {
    const scope: MemoryScope = input.scope ?? {}
    const clauses = ["m.status = 'active'"]
    const values: SQLInputValue[] = []
    appendScopeFilter(clauses, values, 'user_scope', scope.user)
    appendScopeFilter(clauses, values, 'project_scope', scope.project)
    appendScopeFilter(clauses, values, 'site_scope', scope.site)
    appendScopeFilter(clauses, values, 'extension_scope', scope.extension)
    const searchText = normalizeSearchText(input.query)
    const ftsQuery = normalizeFtsQuery(input.query)
    if (!searchText) return []
    if ([...searchText.replace(/\s/gu, '')].length < 3 || !ftsQuery) {
      const like = `%${searchText}%`
      const rows = this.database.prepare(`
        SELECT m.*
        FROM memories m
        WHERE ${clauses.join(' AND ')}
          AND (m.key LIKE ? OR m.content LIKE ? OR m.facts_json LIKE ?)
        ORDER BY
          CASE WHEN m.last_verified_at IS NULL THEN 1 ELSE 0 END,
          m.last_verified_at DESC,
          m.updated_at DESC,
          m.confidence DESC
        LIMIT ?
      `).all(...values, like, like, like, Math.min(20, Math.max(1, input.limit ?? 8))) as unknown as MemoryRow[]
      return rows.map(rowToRecord)
    }
    values.unshift(ftsQuery)
    values.push(Math.min(20, Math.max(1, input.limit ?? 8)))
    const rows = this.database.prepare(`
      SELECT m.*
      FROM memory_fts f
      JOIN memories m ON m.id = f.memory_id
      WHERE memory_fts MATCH ? AND ${clauses.join(' AND ')}
      ORDER BY bm25(memory_fts),
        CASE WHEN m.last_verified_at IS NULL THEN 1 ELSE 0 END,
        m.last_verified_at DESC,
        m.updated_at DESC,
        m.confidence DESC
      LIMIT ?
    `).all(...values) as unknown as MemoryRow[]
    return rows.map(rowToRecord)
  }

  listActive(input: ActiveMemoryListInput = {}): MemoryRecord[] {
    const scope: MemoryScope = input.scope ?? {}
    const clauses = ["m.status = 'active'"]
    const values: SQLInputValue[] = []
    appendScopeFilter(clauses, values, 'user_scope', scope.user)
    appendScopeFilter(clauses, values, 'project_scope', scope.project)
    appendScopeFilter(clauses, values, 'site_scope', scope.site)
    appendScopeFilter(clauses, values, 'extension_scope', scope.extension)
    if (input.type) {
      clauses.push('m.type = ?')
      values.push(input.type)
    }
    const rows = this.database.prepare(`
      SELECT m.*
      FROM memories m
      WHERE ${clauses.join(' AND ')}
      ORDER BY
        CASE WHEN m.last_verified_at IS NULL THEN 1 ELSE 0 END,
        m.last_verified_at DESC,
        m.updated_at DESC,
        m.confidence DESC
      LIMIT ?
    `).all(...values, Math.min(20, Math.max(1, input.limit ?? 8))) as unknown as MemoryRow[]
    return rows.map(rowToRecord)
  }

  /**
   * 容量管理专用读取：返回全部 active 记录（不分作用域、不受公共召回的 20 条上限约束）。
   * 仅用于记忆预算执行与 Renderer 记忆查询，不参与上下文召回。
   */
  listActiveAll(): MemoryRecord[] {
    const rows = this.database.prepare(`
      SELECT m.*
      FROM memories m
      WHERE m.status = 'active'
      ORDER BY m.updated_at DESC, m.confidence DESC
    `).all() as unknown as MemoryRow[]
    return rows.map(rowToRecord)
  }

  close(): void {
    this.database.close()
  }
}

let defaultStore: MemoryStore | null = null

export function getMemoryStore(): MemoryStore {
  defaultStore ??= new MemoryStore()
  return defaultStore
}
