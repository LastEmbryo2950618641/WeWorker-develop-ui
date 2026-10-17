import { create } from 'zustand'
import { fetchAgents } from '../api/dedicated-agents-api.js'
import { useWorksStore } from './works.js'
import { useScheduledTasksStore } from './scheduled-tasks.js'
import { useToolPackagePageStore } from './tool-package-page.js'
import { useExplorationPageStore } from './exploration-page.js'
import { useWebsiteExplorationStore, leaveWebsiteExploration } from './website-exploration.js'

/** view: 'list' (empty state / intro), 'create' (wizard) or 'detail' (selectedId). */
export const useDedicatedAgentsStore = create((set) => ({
  open: false,
  view: 'list',
  selectedId: null,
  agents: [],
  draftAgentId: null,
  loaded: false,
  loadError: '',

  openPage: () => set({ open: true }),
  closePage: () => set({ open: false }),
  startCreate: () => set((state) => {
    const existing = state.agents.find((agent) => agent.draft)
    if (existing) return { view: 'create', selectedId: existing.id, draftAgentId: existing.id }
    const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const draft = {
      id,
      draft: true,
      name: '新建专属 Agent',
      description: '',
      site_id: '',
      skill_name: '',
      examples: [],
      enabled: true,
      paired: false,
      connection: { status: 'stopped' },
      wecom: { bot_id: '', has_secret: false },
    }
    return { agents: [...state.agents, draft], view: 'create', selectedId: id, draftAgentId: id }
  }),
  selectAgent: (id) => set((state) => {
    const selected = id ? state.agents.find((agent) => agent.id === id) : null
    return { view: selected?.draft ? 'create' : (id ? 'detail' : 'list'), selectedId: id || null }
  }),

  /** Keep the in-progress wizard visible without persisting a partial backend record. */
  updateDraftAgent: (patch) => set((state) => {
    const draft = state.agents.find((agent) => agent.draft)
    if (!draft) return {}
    const nextId = patch?.id || draft.id
    return {
      agents: state.agents.map((entry) => entry.id === draft.id
        ? { ...entry, ...patch, id: nextId, draft: true }
        : entry),
      draftAgentId: nextId,
      selectedId: state.selectedId === draft.id ? nextId : state.selectedId,
    }
  }),

  cancelCreate: () => set((state) => ({
    agents: state.agents.filter((agent) => !agent.draft),
    draftAgentId: null,
    view: 'list',
    selectedId: null,
  })),

  /** Replace the temporary row once the wizard has completed pairing. */
  completeCreate: (agent) => set((state) => ({
    agents: [
      ...state.agents.filter((entry) => !entry.draft && entry.id !== agent?.id),
      ...(agent?.id ? [{ ...agent, draft: false }] : []),
    ],
    draftAgentId: null,
    view: agent?.id ? 'detail' : 'list',
    selectedId: agent?.id || null,
  })),

  loadAgents: async () => {
    try {
      const agents = await fetchAgents()
      set((state) => {
        const drafts = state.agents.filter((agent) => agent.draft)
        const draftIds = new Set(drafts.map((agent) => agent.id))
        return { agents: [...agents.filter((agent) => !draftIds.has(agent.id)), ...drafts], loaded: true, loadError: '' }
      })
      return agents
    } catch (error) {
      set({ loaded: true, loadError: error.message || '加载失败' })
      return null
    }
  },

  upsertAgent: (agent) => set((state) => {
    if (!agent?.id) return {}
    const exists = state.agents.some((entry) => entry.id === agent.id)
    return {
      agents: exists
        ? state.agents.map((entry) => (entry.id === agent.id ? { ...entry, ...agent, draft: entry.draft || agent.draft } : entry))
        : [...state.agents, agent],
    }
  }),

  removeAgent: (id) => set((state) => ({
    agents: state.agents.filter((entry) => entry.id !== id),
    selectedId: state.selectedId === id ? null : state.selectedId,
    view: state.selectedId === id ? 'list' : state.view,
  })),
}))

/** Close every other main view and show the 专属 Agent page. */
export async function showDedicatedAgentsPage() {
  if (!await leaveWebsiteExploration()) return false
  useToolPackagePageStore.getState().closePage()
  useExplorationPageStore.getState().closePage()
  useWorksStore.setState({ activeWorkId: null })
  useScheduledTasksStore.setState({ activeTaskId: null })
  useDedicatedAgentsStore.getState().openPage()
  return true
}

// Opening any other main view closes the 专属 Agent page, so existing
// navigation handlers do not need to know about it.
const closeWhen = (opened) => {
  if (opened && useDedicatedAgentsStore.getState().open) useDedicatedAgentsStore.getState().closePage()
}
useWorksStore.subscribe((state, previous) => {
  if (state.activeWorkId && state.activeWorkId !== previous.activeWorkId) closeWhen(true)
})
useScheduledTasksStore.subscribe((state, previous) => {
  if (state.activeTaskId && state.activeTaskId !== previous.activeTaskId) closeWhen(true)
})
useToolPackagePageStore.subscribe((state, previous) => closeWhen(state.open && !previous.open))
useExplorationPageStore.subscribe((state, previous) => closeWhen(state.open && !previous.open))
useWebsiteExplorationStore.subscribe((state, previous) => closeWhen(state.open && !previous.open))
