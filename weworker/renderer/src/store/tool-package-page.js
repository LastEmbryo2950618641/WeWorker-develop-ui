import { create } from 'zustand'

export const SKILL_SCOPE_SITE = 'site'
export const SKILL_SCOPE_PUBLIC = 'public'
export const WORKSPACE_TAB_SKILLS = 'skills'
export const WORKSPACE_TAB_SCENARIOS = 'scenarios'

function normalizeWorkspaceTab(tab) {
  return tab === WORKSPACE_TAB_SCENARIOS ? WORKSPACE_TAB_SCENARIOS : WORKSPACE_TAB_SKILLS
}

function normalizeSiteIds(siteIds, fallbackSiteId = '') {
  const ids = Array.isArray(siteIds)
    ? siteIds.filter(Boolean)
    : (siteIds ? [siteIds] : [])
  if (ids.length > 0) return [...new Set(ids)]
  return fallbackSiteId ? [fallbackSiteId] : []
}

export const useToolPackagePageStore = create((set) => ({
  open: false,
  openSessionId: 0,
  workspaceTab: WORKSPACE_TAB_SKILLS,
  selectedSiteIds: [],
  scenarioSiteIds: [],
  skillScope: SKILL_SCOPE_SITE,
  selectedPublicSkillName: '',
  openPage: (siteId, options = {}) => set((state) => {
    const normalizedSiteId = typeof siteId === 'string' && siteId ? siteId : ''
    const nextSiteIds = normalizedSiteId
      ? [normalizedSiteId]
      : state.selectedSiteIds
    const nextScenarioSiteIds = normalizedSiteId
      ? [normalizedSiteId]
      : (state.scenarioSiteIds.length > 0 ? [state.scenarioSiteIds[0]] : state.selectedSiteIds.slice(0, 1))
    return {
      open: true,
      openSessionId: state.openSessionId + 1,
      workspaceTab: normalizeWorkspaceTab(options.workspaceTab),
      selectedPublicSkillName: options.publicSkillName || '',
      ...(options.publicSkillName ? { skillScope: SKILL_SCOPE_PUBLIC } : {}),
      selectedSiteIds: nextSiteIds,
      scenarioSiteIds: nextScenarioSiteIds,
    }
  }),
  closePage: () => set({ open: false }),
  setSkillScope: (skillScope) => set({
    skillScope: skillScope === SKILL_SCOPE_PUBLIC ? SKILL_SCOPE_PUBLIC : SKILL_SCOPE_SITE,
  }),
  setSelectedSiteIds: (siteIds) => set({
    selectedSiteIds: normalizeSiteIds(siteIds),
  }),
  toggleSelectedSiteId: (siteId) => set((state) => {
    const current = normalizeSiteIds(state.selectedSiteIds)
    if (!siteId) return state
    if (current.includes(siteId)) {
      if (current.length <= 1) return state
      return { selectedSiteIds: current.filter((id) => id !== siteId) }
    }
    return { selectedSiteIds: [...current, siteId] }
  }),
  setSelectedSiteId: (siteId) => set({
    selectedSiteIds: siteId ? [siteId] : [],
  }),
  setScenarioSiteIds: (siteIds) => set({
    scenarioSiteIds: normalizeSiteIds(siteIds).slice(0, 1),
  }),
  toggleScenarioSiteId: (siteId) => set((state) => {
    if (!siteId) return state
    if (state.scenarioSiteIds[0] === siteId) return state
    return { scenarioSiteIds: [siteId] }
  }),
}))
