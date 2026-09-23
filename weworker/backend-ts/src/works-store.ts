import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import type { LoadedSkillContext } from './skill-context.js'

const DB_DIR = path.join(os.homedir(), '.weworker')
const DB_FILE = path.join(DB_DIR, 'works.db')

export type LabelColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | null

export interface Work {
  id: string
  title: string
  label: LabelColor
  zcf_role: string | null
  zcf_mode: string | null
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  work_id: string
  role: string
  content: ContentBlock[]
  created_at: string
}

export type ContentBlock =
  | LoadedSkillContext
  | { type: 'text'; text: string }
  | { type: 'file_attachment'; name: string; path: string; size?: number; modified_at?: string; mime?: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'tool_use'; id: string; name: string; args: unknown; result?: string; status?: string; image?: string; thinkMs?: number; execMs?: number }
  | { type: 'timing'; totalMs: number; llmMs: number; execMs: number; steps: number; routeTool?: string; routeSource?: string; routeArgs?: string }
  | { type: 'error'; text: string }

export interface WorkWithMessages extends Work {
  messages: Message[]
}

export interface ScheduledTask {
  id: string
  title: string
  cron_expression: string
  prompt_template: string
  enabled: boolean
  notify_channels: string[]
  created_at: string
  updated_at: string
}

export interface TaskExecution {
  id: string
  task_id: string
  work_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  error_message?: string
  started_at?: string
  completed_at?: string
}

export interface ScheduledTaskWithLastExecution extends ScheduledTask {
  last_execution_status?: string
}

let _db: DatabaseSync | null = null

function db(): DatabaseSync {
  if (_db) return _db
  fs.mkdirSync(DB_DIR, { recursive: true })
  _db = new DatabaseSync(DB_FILE)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS works (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      label TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS channel_sessions (
      channel_type TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      work_id TEXT NOT NULL,
      PRIMARY KEY (channel_type, external_user_id)
    );
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      prompt_template TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      notify_channels TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_executions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      work_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS channel_notify_targets (
      channel_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      extra TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (channel_type, user_id)
    );
  `)
  // Migration: add label column for existing databases
  try {
    _db.exec('ALTER TABLE works ADD COLUMN label TEXT DEFAULT NULL')
  } catch {
    // Column already exists — ignore
  }
  try {
    _db.exec('ALTER TABLE works ADD COLUMN zcf_role TEXT DEFAULT NULL')
  } catch {
    // Column already exists — ignore
  }
  try {
    _db.exec('ALTER TABLE works ADD COLUMN zcf_mode TEXT DEFAULT NULL')
  } catch {
    // Column already exists — ignore
  }
  return _db
}

export function createWork(title = ''): Work {
  const now = new Date().toISOString()
  const id = randomUUID()
  db().prepare('INSERT INTO works (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, title, now, now)
  return { id, title, label: null, zcf_role: null, zcf_mode: null, created_at: now, updated_at: now }
}

export function updateWorkZcfPrefs(
  id: string,
  prefs: { zcf_role?: string | null; zcf_mode?: string | null },
): Work | null {
  const work = getWork(id)
  if (!work) return null
  const zcf_role = prefs.zcf_role !== undefined ? prefs.zcf_role : work.zcf_role
  const zcf_mode = prefs.zcf_mode !== undefined ? prefs.zcf_mode : work.zcf_mode
  const now = new Date().toISOString()
  db().prepare('UPDATE works SET zcf_role = ?, zcf_mode = ?, updated_at = ? WHERE id = ?').run(
    zcf_role,
    zcf_mode,
    now,
    id,
  )
  return { ...work, zcf_role, zcf_mode, updated_at: now }
}

export function listWorks(): Work[] {
  return db().prepare('SELECT * FROM works ORDER BY updated_at DESC').all() as unknown as Work[]
}

export function getWork(id: string): Work | null {
  return (db().prepare('SELECT * FROM works WHERE id = ?').get(id) as unknown as Work) ?? null
}

export function getWorkWithMessages(id: string): WorkWithMessages | null {
  const work = getWork(id)
  if (!work) return null
  const rows = db().prepare('SELECT * FROM messages WHERE work_id = ? ORDER BY created_at ASC').all(id) as Array<{
    id: string; work_id: string; role: string; content: string; created_at: string
  }>
  const messages: Message[] = rows.map(r => ({
    ...r,
    content: JSON.parse(r.content) as ContentBlock[],
  }))
  return { ...work, messages }
}

export function appendMessage(workId: string, role: string, content: ContentBlock[], external = false): Message {
  const now = new Date().toISOString()
  const id = randomUUID()
  db().prepare('INSERT INTO messages (id, work_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id, workId, role, JSON.stringify(content), now
  )
  db().prepare('UPDATE works SET updated_at = ? WHERE id = ?').run(now, workId)
  if (external) {
    // Signal external write for polling
    db().prepare('UPDATE works SET updated_at = ? WHERE id = ?').run(now, workId)
  }
  return { id, work_id: workId, role, content, created_at: now }
}

export function updateTitle(workId: string, title: string): void {
  db().prepare('UPDATE works SET title = ?, updated_at = ? WHERE id = ?').run(title, new Date().toISOString(), workId)
}

export function updateTitlePreserveOrder(workId: string, title: string): void {
  db().prepare('UPDATE works SET title = ? WHERE id = ?').run(title, workId)
}

export function updateLabel(workId: string, label: LabelColor): void {
  db().prepare('UPDATE works SET label = ?, updated_at = ? WHERE id = ?').run(label, new Date().toISOString(), workId)
}

export function deleteWork(workId: string): void {
  db().prepare('DELETE FROM messages WHERE work_id = ?').run(workId)
  db().prepare('DELETE FROM works WHERE id = ?').run(workId)
}

export function deleteMessages(messageIds: string[]): void {
  if (messageIds.length === 0) return
  const placeholders = messageIds.map(() => '?').join(',')
  db().prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...messageIds)
}

export function getOrCreateChannelWork(
  channelType: string,
  externalUserId: string,
  displayName: string
): { work: Work; created: boolean } {
  const row = db().prepare('SELECT work_id FROM channel_sessions WHERE channel_type = ? AND external_user_id = ?').get(
    channelType, externalUserId
  ) as { work_id: string } | undefined

  if (row) {
    const work = getWork(row.work_id)
    if (work) return { work, created: false }
  }

  const work = createWork(displayName)
  db().prepare('INSERT OR REPLACE INTO channel_sessions (channel_type, external_user_id, work_id) VALUES (?, ?, ?)').run(
    channelType, externalUserId, work.id
  )
  return { work, created: true }
}

export function resetChannelWork(channelType: string, externalUserId: string, displayName = ''): Work {
  db().prepare('DELETE FROM channel_sessions WHERE channel_type = ? AND external_user_id = ?').run(channelType, externalUserId)
  const work = createWork(displayName)
  db().prepare('INSERT INTO channel_sessions (channel_type, external_user_id, work_id) VALUES (?, ?, ?)').run(
    channelType, externalUserId, work.id
  )
  return work
}

// Track last external write timestamp for polling
let _lastExternalWrite = ''

export function markExternalWrite(): void {
  _lastExternalWrite = new Date().toISOString()
}

export function getLastExternalWrite(): string {
  return _lastExternalWrite
}


// --- Scheduled Tasks CRUD ---

function rowToScheduledTask(row: Record<string, unknown>): ScheduledTask {
  return {
    id: row.id as string,
    title: row.title as string,
    cron_expression: row.cron_expression as string,
    prompt_template: row.prompt_template as string,
    enabled: (row.enabled as number) === 1,
    notify_channels: JSON.parse(row.notify_channels as string) as string[],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

export function createScheduledTask(
  task: Omit<ScheduledTask, 'id' | 'created_at' | 'updated_at'>
): ScheduledTask {
  const now = new Date().toISOString()
  const id = randomUUID()
  db()
    .prepare(
      'INSERT INTO scheduled_tasks (id, title, cron_expression, prompt_template, enabled, notify_channels, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      id,
      task.title,
      task.cron_expression,
      task.prompt_template,
      task.enabled ? 1 : 0,
      JSON.stringify(task.notify_channels),
      now,
      now
    )
  return {
    id,
    title: task.title,
    cron_expression: task.cron_expression,
    prompt_template: task.prompt_template,
    enabled: task.enabled,
    notify_channels: task.notify_channels,
    created_at: now,
    updated_at: now,
  }
}

export function listScheduledTasks(): ScheduledTaskWithLastExecution[] {
  const rows = db()
    .prepare(
      `SELECT st.*, le.status AS last_execution_status
       FROM scheduled_tasks st
       LEFT JOIN (
         SELECT task_id, status
         FROM task_executions te1
         WHERE te1.started_at = (
           SELECT MAX(te2.started_at)
           FROM task_executions te2
           WHERE te2.task_id = te1.task_id
         )
       ) le ON le.task_id = st.id
       ORDER BY st.created_at DESC`
    )
    .all() as Array<Record<string, unknown>>

  return rows.map((row) => ({
    ...rowToScheduledTask(row),
    last_execution_status: (row.last_execution_status as string) ?? undefined,
  }))
}

export function getScheduledTask(id: string): ScheduledTask | null {
  const row = db()
    .prepare('SELECT * FROM scheduled_tasks WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return rowToScheduledTask(row)
}

export function updateScheduledTask(
  id: string,
  updates: Partial<Pick<ScheduledTask, 'title' | 'cron_expression' | 'prompt_template' | 'enabled' | 'notify_channels'>>
): ScheduledTask | null {
  const existing = getScheduledTask(id)
  if (!existing) return null

  const setClauses: string[] = []
  const values: SQLInputValue[] = []

  if (updates.title !== undefined) {
    setClauses.push('title = ?')
    values.push(updates.title)
  }
  if (updates.cron_expression !== undefined) {
    setClauses.push('cron_expression = ?')
    values.push(updates.cron_expression)
  }
  if (updates.prompt_template !== undefined) {
    setClauses.push('prompt_template = ?')
    values.push(updates.prompt_template)
  }
  if (updates.enabled !== undefined) {
    setClauses.push('enabled = ?')
    values.push(updates.enabled ? 1 : 0)
  }
  if (updates.notify_channels !== undefined) {
    setClauses.push('notify_channels = ?')
    values.push(JSON.stringify(updates.notify_channels))
  }

  if (setClauses.length === 0) return existing

  const now = new Date().toISOString()
  setClauses.push('updated_at = ?')
  values.push(now)
  values.push(id)

  db()
    .prepare(`UPDATE scheduled_tasks SET ${setClauses.join(', ')} WHERE id = ?`)
    .run(...values)

  return getScheduledTask(id)
}

export function deleteScheduledTask(id: string): void {
  db().prepare('DELETE FROM task_executions WHERE task_id = ?').run(id)
  db().prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
}

export function getEnabledScheduledTasks(): ScheduledTask[] {
  const rows = db()
    .prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1')
    .all() as Array<Record<string, unknown>>
  return rows.map(rowToScheduledTask)
}

// --- Task Executions CRUD ---

export function createTaskExecution(taskId: string, workId: string): TaskExecution {
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  db()
    .prepare(
      'INSERT INTO task_executions (id, task_id, work_id, status, started_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(id, taskId, workId, 'pending', startedAt)
  return {
    id,
    task_id: taskId,
    work_id: workId,
    status: 'pending',
    started_at: startedAt,
  }
}

export function updateTaskExecution(
  id: string,
  updates: Partial<Pick<TaskExecution, 'status' | 'error_message' | 'completed_at'>>
): void {
  const setClauses: string[] = []
  const values: SQLInputValue[] = []

  if (updates.status !== undefined) {
    setClauses.push('status = ?')
    values.push(updates.status)
  }
  if (updates.error_message !== undefined) {
    setClauses.push('error_message = ?')
    values.push(updates.error_message)
  }
  if (updates.completed_at !== undefined) {
    setClauses.push('completed_at = ?')
    values.push(updates.completed_at)
  }

  if (setClauses.length === 0) return

  values.push(id)
  db()
    .prepare(`UPDATE task_executions SET ${setClauses.join(', ')} WHERE id = ?`)
    .run(...values)
}

export function listTaskExecutions(taskId: string): TaskExecution[] {
  const rows = db()
    .prepare('SELECT * FROM task_executions WHERE task_id = ? ORDER BY started_at DESC')
    .all(taskId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: row.id as string,
    task_id: row.task_id as string,
    work_id: row.work_id as string,
    status: row.status as TaskExecution['status'],
    error_message: (row.error_message as string) ?? undefined,
    started_at: (row.started_at as string) ?? undefined,
    completed_at: (row.completed_at as string) ?? undefined,
  }))
}


// --- Channel Notify Targets ---

export interface ChannelNotifyTarget {
  channel_type: string
  user_id: string
  extra: Record<string, string>
  updated_at: string
}

/** Upsert a channel notify target (called when a user sends a message via channel) */
export function saveChannelNotifyTarget(
  channelType: string,
  userId: string,
  extra: Record<string, string> = {},
): void {
  const now = new Date().toISOString()
  db()
    .prepare(
      'INSERT OR REPLACE INTO channel_notify_targets (channel_type, user_id, extra, updated_at) VALUES (?, ?, ?, ?)'
    )
    .run(channelType, userId, JSON.stringify(extra), now)
}

/** Get the most recent notify target for a channel type */
export function getLatestChannelNotifyTarget(channelType: string): ChannelNotifyTarget | null {
  const row = db()
    .prepare('SELECT * FROM channel_notify_targets WHERE channel_type = ? ORDER BY updated_at DESC LIMIT 1')
    .get(channelType) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    channel_type: row.channel_type as string,
    user_id: row.user_id as string,
    extra: JSON.parse(row.extra as string) as Record<string, string>,
    updated_at: row.updated_at as string,
  }
}

/** Return the current database instance (for testing only). */
export function _getTestDb(): DatabaseSync {
  return db()
}

/** Reset the database to a fresh in-memory instance (for testing only). */
export function _initTestDb(): void {
  if (_db) {
    _db.close()
  }
  _db = new DatabaseSync(':memory:')
  _db.exec('PRAGMA foreign_keys = ON')
  _db.exec(`
    CREATE TABLE IF NOT EXISTS works (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      label TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS channel_sessions (
      channel_type TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      work_id TEXT NOT NULL,
      PRIMARY KEY (channel_type, external_user_id)
    );
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      prompt_template TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      notify_channels TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_executions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      work_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS channel_notify_targets (
      channel_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      extra TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (channel_type, user_id)
    );
  `)
}
