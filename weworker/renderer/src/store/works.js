import { create } from 'zustand'
import { mapMessageContentAfterStop } from '../utils/chat-generation-stop.js'
import { applyTerminalEventToMessages } from '../utils/terminal-chat-output.js'
import { calibrateCompactedContextSnapshot, calibrateContextSnapshot, createContextTokenAnchor, projectIncrementalContextSnapshot } from '../utils/context-snapshot.js'
import { backendFetch } from '../api/http.js'
import { leaveWebsiteExploration } from './website-exploration.js'

const API = 'http://127.0.0.1:8765'

// Lazy import to avoid circular dependency
let _scheduledTasksStore = null
function getScheduledTasksStore() {
  if (!_scheduledTasksStore) {
    _scheduledTasksStore = import('./scheduled-tasks.js').then(m => m.useScheduledTasksStore)
  }
  return _scheduledTasksStore
}

export const useWorksStore = create((set, get) => ({
  works: [],
  activeWorkId: null,
  messages: {}, // workId -> Message[]
  drafts: {}, // Unsent text and attachments survive switching between works.
  updateDraft: (workId, patch) => set((s) => {
    const previous = s.drafts[workId] ?? { text: '', attachments: [] }
    const changes = typeof patch === 'function' ? patch(previous) : patch
    return { drafts: { ...s.drafts, [workId]: { ...previous, ...changes } } }
  }),
  clearDraft: (workId) => set((s) => {
    const drafts = { ...s.drafts }
    delete drafts[workId]
    return { drafts }
  }),
  contextSnapshots: {}, // workId -> latest local context composition
  contextTokenAnchors: {}, // workId -> provider total and calibrated non-conversation baseline
  contextCompactionStatuses: {}, // workId -> compacting/completed/skipped/failed
  memoryStatuses: {}, // workId -> latest explicit memory processing status
  healthCheckMeta: null, // { siteId, siteName, toolNames } | null
  streamingWorkIds: new Set(), // workIds currently streaming — don't overwrite their messages
  abortControllers: {}, // workId -> AbortController — for stopping streaming from any view
  labelFilter: null, // null = show all, string = filter by label color
  labelNames: {}, // color -> custom name, e.g. { red: '紧急', blue: '参考' }

  loadWorks: async () => {
    const [worksRes, namesRes] = await Promise.all([
      backendFetch(`${API}/works`),
      backendFetch(`${API}/settings/label-names`).catch(() => null),
    ])
    if (!worksRes.ok) return
    const works = await worksRes.json()
    const labelNames = namesRes?.ok ? await namesRes.json() : {}
    set({ works: Array.isArray(works) ? works : [], labelNames })
  },

  createWork: async (opts = {}) => {
    if (!await leaveWebsiteExploration()) return null
    const reuseEmptyWork = async (work) => {
      set({ activeWorkId: work.id })
      getScheduledTasksStore().then(s => s?.setState({ activeTaskId: null })).catch(() => {})
      const prefs = {}
      if (opts.zcf_role !== undefined) prefs.zcf_role = opts.zcf_role
      if (opts.zcf_mode !== undefined) prefs.zcf_mode = opts.zcf_mode
      const roleChanged = prefs.zcf_role !== undefined && work.zcf_role !== prefs.zcf_role
      const modeChanged = prefs.zcf_mode !== undefined && work.zcf_mode !== prefs.zcf_mode
      if (roleChanged || modeChanged) {
        return get().updateWorkZcfPrefs(work.id, prefs)
      }
      return work
    }

    try {
      // If the most recent work is empty (no messages), just switch to it
      const { works, messages } = get()
      if (!opts.forceNew && works.length > 0) {
        const latest = works[0]
        const latestMsgs = messages[latest.id]
        // Empty if: no messages loaded yet and no title, or loaded and truly empty
        const isEmpty = !latest.title && (latestMsgs === undefined || latestMsgs.length === 0)
        if (isEmpty) {
          // If we haven't loaded messages yet, verify with server
          if (latestMsgs === undefined) {
            try {
              const res = await backendFetch(`${API}/works/${latest.id}`)
              if (!res.ok) throw new Error('Failed to load work')
              const data = await res.json()
              set((s) => ({ messages: { ...s.messages, [latest.id]: data.messages } }))
              if (data.messages.length === 0) {
                return reuseEmptyWork(latest)
              }
            } catch { /* fall through to create */ }
          } else {
            return reuseEmptyWork(latest)
          }
        }
      }
      const body = {}
      if (opts.zcf_role !== undefined) body.zcf_role = opts.zcf_role
      if (opts.zcf_mode !== undefined) body.zcf_mode = opts.zcf_mode
      const res = await backendFetch(`${API}/works`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed to create work')
      const work = await res.json()
      set((s) => ({ works: [work, ...s.works], activeWorkId: work.id }))
      getScheduledTasksStore().then(s => s?.setState({ activeTaskId: null })).catch(() => {})
      return work
    } catch (e) {
      console.error('[works] createWork failed:', e)
      window.alert('创建任务失败，请确认后端服务已启动')
      throw e
    }
  },

  selectWork: async (id) => {
    if (!await leaveWebsiteExploration()) return
    set({ activeWorkId: id })
    try { getScheduledTasksStore().then(s => s?.setState({ activeTaskId: null })) } catch {}
    // If this work is currently streaming, don't overwrite in-memory messages with backend data
    // (assistant message hasn't been persisted yet)
    if (get().streamingWorkIds.has(id)) return
    // Always fetch latest messages from backend (channel messages may have been added externally)
    try {
      const res = await backendFetch(`${API}/works/${id}`)
      const data = await res.json()
      set((s) => ({ messages: { ...s.messages, [id]: data.messages } }))
    } catch (e) {
      console.error('[works] selectWork fetch failed:', e)
    }
  },

  deleteWork: async (id) => {
    try {
      const res = await backendFetch(`${API}/works/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete work')
      set((s) => {
        const works = s.works.filter((w) => w.id !== id)
        const messages = { ...s.messages }
        const drafts = { ...s.drafts }
        const contextSnapshots = { ...s.contextSnapshots }
        const contextTokenAnchors = { ...s.contextTokenAnchors }
        const contextCompactionStatuses = { ...s.contextCompactionStatuses }
        delete messages[id]
        delete drafts[id]
        delete contextSnapshots[id]
        delete contextTokenAnchors[id]
        delete contextCompactionStatuses[id]
        return {
          works,
          messages,
          drafts,
          contextSnapshots,
          contextTokenAnchors,
          contextCompactionStatuses,
          activeWorkId: s.activeWorkId === id ? (works[0]?.id ?? null) : s.activeWorkId,
        }
      })
    } catch (e) {
      console.error('[works] deleteWork failed:', e)
      window.alert('删除任务失败，请稍后重试')
      throw e
    }
  },

  updateTitle: async (id, title) => {
    const nextTitle = title.trim()
    if (!nextTitle) return
    const res = await backendFetch(`${API}/works/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: nextTitle, preserveOrder: true }),
    })
    if (!res.ok) throw new Error('Failed to update title')
    set((s) => ({
      works: s.works.map((w) => (w.id === id ? { ...w, title: nextTitle } : w)),
    }))
  },

  updateLabel: async (id, label) => {
    await backendFetch(`${API}/works/${id}/label`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    })
    set((s) => ({
      works: s.works.map((w) => (w.id === id ? { ...w, label } : w)),
    }))
  },

  updateWorkZcfPrefs: async (id, prefs) => {
    const previous = get().works.find((w) => w.id === id)
    set((s) => ({
      works: s.works.map((w) => (w.id === id ? { ...w, ...prefs } : w)),
    }))
    try {
      const res = await backendFetch(`${API}/works/${id}/zcf`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      })
      if (!res.ok) throw new Error('Failed to update ZCF prefs')
      const work = await res.json()
      set((s) => ({
        works: s.works.map((w) => (w.id === id ? { ...w, ...work } : w)),
      }))
      return work
    } catch (e) {
      if (previous) {
        set((s) => ({
          works: s.works.map((w) => (w.id === id ? { ...w, ...previous } : w)),
        }))
      }
      throw e
    }
  },

  setLabelFilter: (label) => {
    set({ labelFilter: label })
  },

  saveLabelName: async (color, name) => {
    const updated = { ...get().labelNames }
    if (name.trim()) {
      updated[color] = name.trim()
    } else {
      delete updated[color]
    }
    set({ labelNames: updated })
    await backendFetch(`${API}/settings/label-names`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
  },

  // Local-only title update (backend already persisted it)
  updateTitleLocal: (id, title) => {
    set((s) => ({
      works: s.works.map((w) => (w.id === id ? { ...w, title } : w)),
    }))
  },

  appendMessage: (workId, msg) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [workId]: [...(s.messages[workId] ?? []), msg],
      },
    }))
  },

  updateLastMessage: (workId, updater) => {
    set((s) => {
      const msgs = s.messages[workId] ?? []
      if (!msgs.length) return s
      const updated = [...msgs]
      updated[updated.length - 1] = updater(updated[updated.length - 1])
      return { messages: { ...s.messages, [workId]: updated } }
    })
  },

  handleTerminalEvent: (event) => {
    if (!event || event.type !== 'terminal_event') return
    const workId = event.data?.workId
    if (!workId) return

    set((s) => {
      const messages = s.messages[workId]
      if (!messages?.length) return s
      const nextMessages = applyTerminalEventToMessages(messages, event)
      if (nextMessages === messages) return s
      return {
        messages: {
          ...s.messages,
          [workId]: nextMessages,
        },
      }
    })
  },

  setContextSnapshot: (workId, snapshot) => {
    if (!workId || !snapshot) return
    set((s) => {
      const current = s.contextSnapshots[workId]
      const isCompactionSnapshot = snapshot.compaction?.mode === 'conversation_only'
      const hasProviderUsage = snapshot.token_source === 'provider_calibrated'
        && Number.isFinite(Number(snapshot.actual_input_tokens))
      const nextSnapshot = !isCompactionSnapshot && !hasProviderUsage && snapshot.phase === 'request_start' && Number.isFinite(Number(current?.actual_input_tokens))
        ? projectIncrementalContextSnapshot(snapshot, current.actual_input_tokens, current.estimated_total_tokens)
        : snapshot
      const nextAnchor = Number.isFinite(Number(snapshot.actual_input_tokens)) && snapshot.token_source === 'provider_calibrated'
        ? createContextTokenAnchor(snapshot)
        : s.contextTokenAnchors[workId]
      return {
        contextSnapshots: { ...s.contextSnapshots, [workId]: nextSnapshot },
        contextTokenAnchors: { ...s.contextTokenAnchors, [workId]: nextAnchor },
      }
    })
  },

  setContextUsage: (workId, usage) => {
    const actualInputTokens = Number(usage?.context_input_tokens ?? usage?.total_input_tokens)
    if (!workId || !Number.isFinite(actualInputTokens)) return
    set((s) => {
      const current = s.contextSnapshots[workId]
      if (!current) return s
      const isPostCompactionProbe = usage?.kind === 'post_compaction_probe'
      const nextSnapshot = isPostCompactionProbe
        ? calibrateCompactedContextSnapshot(current, actualInputTokens, s.contextTokenAnchors[workId])
        : calibrateContextSnapshot(current, actualInputTokens)
      const nextAnchor = createContextTokenAnchor(nextSnapshot)
      return {
        contextSnapshots: {
          ...s.contextSnapshots,
          [workId]: nextSnapshot,
        },
        contextTokenAnchors: { ...s.contextTokenAnchors, [workId]: nextAnchor },
      }
    })
  },

  setContextCompactionStatus: (workId, status) => {
    if (!workId) return
    set((s) => {
      const contextCompactionStatuses = { ...s.contextCompactionStatuses }
      if (!status) delete contextCompactionStatuses[workId]
      else contextCompactionStatuses[workId] = status
      return { contextCompactionStatuses }
    })
  },

  setMemoryStatus: (workId, status) => {
    if (!workId || !status) return
    set((s) => {
      const current = s.memoryStatuses[workId]
      const isStaleCompletion = status.status !== 'processing'
        && current?.status === 'processing'
        && current.eventId
        && status.eventId
        && current.eventId !== status.eventId
      if (isStaleCompletion) return s
      return { memoryStatuses: { ...s.memoryStatuses, [workId]: status } }
    })
  },

  clearMemoryStatus: (workId) => {
    if (!workId) return
    set((s) => {
      if (!(workId in s.memoryStatuses)) return s
      const memoryStatuses = { ...s.memoryStatuses }
      delete memoryStatuses[workId]
      return { memoryStatuses }
    })
  },

  stopGeneration: (workId) => {
    set((s) => {
      const nextStreaming = new Set(s.streamingWorkIds)
      nextStreaming.delete(workId)
      const controllers = { ...s.abortControllers }
      delete controllers[workId]

      const msgs = s.messages[workId] ?? []
      if (!msgs.length) {
        return { streamingWorkIds: nextStreaming, abortControllers: controllers }
      }

      const updated = [...msgs]
      const last = updated[updated.length - 1]
      updated[updated.length - 1] = {
        ...last,
        content: mapMessageContentAfterStop(last.content),
      }

      return {
        messages: { ...s.messages, [workId]: updated },
        streamingWorkIds: nextStreaming,
        abortControllers: controllers,
      }
    })
  },

  startHealthCheck: async (siteId, siteName, toolNames, prompt) => {
    const res = await backendFetch(`${API}/works`, { method: 'POST' })
    const work = await res.json()
    // Rename the work to indicate health check
    await backendFetch(`${API}/works/${work.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `[健康检查] ${siteName}` }),
    })
    set((s) => ({
      works: [{ ...work, title: `[健康检查] ${siteName}` }, ...s.works],
      activeWorkId: work.id,
      healthCheckMeta: { siteId, siteName, toolNames, workId: work.id },
      pendingMessage: prompt,
    }))
    try { getScheduledTasksStore().then(s => s?.setState({ activeTaskId: null })) } catch {}
    return work
  },
}))
