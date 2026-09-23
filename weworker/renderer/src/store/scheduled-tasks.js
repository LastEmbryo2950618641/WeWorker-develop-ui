import { create } from 'zustand'
import { useWorksStore } from './works'
import { backendFetch } from '../api/http.js'
import { leaveWebsiteExploration } from './website-exploration.js'

export const useScheduledTasksStore = create((set, get) => ({
  tasks: [],
  activeTaskId: null,
  executions: {}, // taskId -> TaskExecution[]

  loadTasks: async () => {
    const res = await backendFetch('/scheduled-tasks')
    if (!res.ok) return
    const data = await res.json()
    set({ tasks: Array.isArray(data.tasks) ? data.tasks : [] })
  },

  createTask: async (config) => {
    if (!await leaveWebsiteExploration()) return null
    const res = await backendFetch('/scheduled-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }))
      console.error('[scheduled-tasks] createTask failed:', err)
      return null
    }
    const task = await res.json()
    set((s) => ({ tasks: [task, ...s.tasks], activeTaskId: task.id }))
    useWorksStore.setState({ activeWorkId: null })
    return task
  },

  selectTask: async (id) => {
    if (!await leaveWebsiteExploration()) return
    set({ activeTaskId: id })
    useWorksStore.setState({ activeWorkId: null })
    // Load executions for the selected task
    const res = await backendFetch(`/scheduled-tasks/${id}`)
    if (!res.ok) return
    const data = await res.json()
    set((s) => ({ executions: { ...s.executions, [id]: Array.isArray(data.executions) ? data.executions : [] } }))
  },

  updateTask: async (id, updates) => {
    const res = await backendFetch(`/scheduled-tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const updated = await res.json()
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? updated : t)),
    }))
    return updated
  },

  deleteTask: async (id) => {
    await backendFetch(`/scheduled-tasks/${id}`, { method: 'DELETE' })
    set((s) => {
      const tasks = s.tasks.filter((t) => t.id !== id)
      const executions = { ...s.executions }
      delete executions[id]
      return {
        tasks,
        executions,
        activeTaskId: s.activeTaskId === id ? null : s.activeTaskId,
      }
    })
  },

  loadExecutions: async (taskId) => {
    const res = await backendFetch(`/scheduled-tasks/${taskId}`)
    if (!res.ok) return
    const data = await res.json()
    set((s) => ({ executions: { ...s.executions, [taskId]: Array.isArray(data.executions) ? data.executions : [] } }))
  },
}))
