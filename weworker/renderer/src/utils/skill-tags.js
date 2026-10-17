export const SKILL_TAGS_STORAGE_KEY = 'weworker:skill-tags:v1'

export function skillTagKey(tool) {
  return `${tool.source}:${tool.siteId || ''}:${tool.id || tool.name}`
}

export function normalizeSkillTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : []).filter(tag => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean))]
}

export function defaultSkillTags(tool) {
  const publicSkill = ['public-skill', 'public-custom'].includes(tool.source)
  const custom = ['custom', 'public-custom'].includes(tool.source)
  return normalizeSkillTags([publicSkill ? '公共' : '站点', custom ? '自定义' : '官方', tool.siteName])
}

export function skillTags(tool, overrides) {
  const key = skillTagKey(tool)
  return Object.hasOwn(overrides, key) ? normalizeSkillTags(overrides[key]) : defaultSkillTags(tool)
}

export function matchesSkillSearch(tool, query, tags) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const content = [tool.name, tool.description, ...tags,
    ...(tool.parameters || []).flatMap(param => [param.name, param.type, param.description]),
  ].join(' ').toLocaleLowerCase()
  return words.every(word => content.includes(word))
}

export function loadSkillTagOverrides(storage) {
  try {
    const value = JSON.parse(storage.getItem(SKILL_TAGS_STORAGE_KEY) || '{}')
    if (!value || Array.isArray(value) || typeof value !== 'object') return {}
    return Object.fromEntries(Object.entries(value).filter(([, tags]) => Array.isArray(tags)).map(([key, tags]) => [key, normalizeSkillTags(tags)]))
  } catch { return {} }
}
