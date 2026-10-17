/**
 * 风格设置：内置预定义风格 + 用户自定义风格的解析与注入。
 *
 * 与 ZCF 脱钩后，这里只依赖应用内置的 `PRESET_STYLES` 与设置里的自定义风格，
 * 不再扫描 / 安装 / 同步任何外部模板。
 *
 * 持久化字段名沿用既有 `zcf_*` 键（`zcf_custom_roles` / `zcf_default_role` /
 * `zcf_enabled_roles`）：改名需要数据迁移，而用户要求"不做数据迁移、不丢用户选择"。
 * 这三个键的读写全部收敛在本模块 + config.ts 两处。
 */
import { PRESET_STYLES, findPresetStyle, type PresetStyle } from './style-presets.js'

export { PRESET_STYLES, findPresetStyle }
export type { PresetStyle }

export const DEFAULT_STYLE_ID = 'default'

/** 默认启用「默认」风格（原生模式，不注入任何风格提示词）。 */
export const DEFAULT_ENABLED_STYLES = [DEFAULT_STYLE_ID]

export interface CustomStyle {
  id: string
  label: string
  prompt: string
}

/** 风格相关的设置子集（对应 settings.json 里的 zcf_* 键）。 */
export interface StyleSettings {
  zcf_default_role?: string
  zcf_enabled_roles?: string[]
  zcf_custom_roles?: CustomStyle[]
}

/**
 * 老 settings.json 里的纯 ZCF 残留字段：ZCF 机制已整体移除，这些键没有任何读取方。
 * 加载设置时剔除，避免它们被再次写回磁盘（也让「已删除字段」在数据上真正消失）。
 * 只删这些键；`zcf_default_role` / `zcf_enabled_roles` / `zcf_custom_roles` 必须保留。
 */
export const OBSOLETE_ZCF_SETTINGS_KEYS = [
  'zcf_lang',
  'zcf_default_mode',
  'zcf_package_version',
  'zcf_sync',
] as const

/** 就地删除纯 ZCF 残留字段，返回删除的键名（便于日志/断言）。 */
export function stripObsoleteZcfSettings(target: Record<string, unknown>): string[] {
  const removed: string[] = []
  for (const key of OBSOLETE_ZCF_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(target, key)) {
      delete target[key]
      removed.push(key)
    }
  }
  return removed
}

function slugifyStyleLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'style'
}

export function isCustomStyleId(styleId: string): boolean {
  return styleId.startsWith('custom-')
}

/** 空值/未知残留值一律回落「默认」风格，不做迁移、不报错。 */
export function normalizeDefaultStyleId(styleId: string | null | undefined): string {
  if (!styleId) return DEFAULT_STYLE_ID
  return styleId
}

export function normalizeCustomStyles(styles: unknown): CustomStyle[] {
  if (!Array.isArray(styles)) return []
  const seen = new Set<string>()
  const normalized: CustomStyle[] = []
  for (const raw of styles) {
    if (!raw || typeof raw !== 'object') continue
    const label = String((raw as CustomStyle).label ?? '').trim()
    const prompt = String((raw as CustomStyle).prompt ?? '').trim()
    if (!label || !prompt) continue
    let id = String((raw as CustomStyle).id ?? '').trim()
    if (!id) id = `custom-${slugifyStyleLabel(label)}`
    else if (!id.startsWith('custom-')) id = `custom-${id.replace(/^custom-/, '')}`
    let uniqueId = id
    let suffix = 2
    while (seen.has(uniqueId)) {
      uniqueId = `${id}-${suffix}`
      suffix++
    }
    seen.add(uniqueId)
    normalized.push({ id: uniqueId, label, prompt })
  }
  return normalized
}

/** 可选风格 id：预定义内置风格 + 自定义风格（不含「默认」，它始终可选）。 */
export function listStyleIds(customStyles: CustomStyle[] = []): string[] {
  return [
    DEFAULT_STYLE_ID,
    ...PRESET_STYLES.map((style) => style.id),
    ...customStyles.map((style) => style.id),
  ]
}

/** 风格互斥 —— 只持久化一个生效的风格 id。 */
export function normalizeEnabledStyles(
  enabled: unknown,
  customStyles: CustomStyle[],
  defaultStyle?: string,
): string[] {
  const allowed = new Set(listStyleIds(customStyles))
  let candidate = DEFAULT_STYLE_ID
  if (defaultStyle && allowed.has(defaultStyle)) candidate = defaultStyle
  else if (Array.isArray(enabled)) {
    const valid = enabled.filter((id): id is string => typeof id === 'string' && allowed.has(id))
    if (valid.length >= 1) candidate = valid[0]
  }
  if (!allowed.has(candidate)) candidate = DEFAULT_STYLE_ID
  return [candidate]
}

/** 某次对话实际使用的风格：work 级选择优先，否则用设置里的当前风格。 */
export function resolveStyleId(
  work: { zcf_role?: string | null },
  settings: StyleSettings,
): string {
  const customStyles = settings.zcf_custom_roles || []
  const available = new Set(listStyleIds(customStyles))
  const fallback = normalizeEnabledStyles(
    settings.zcf_enabled_roles,
    customStyles,
    settings.zcf_default_role,
  )[0]
  const candidate = work.zcf_role || fallback
  if (available.has(candidate)) return candidate
  if (available.has(fallback)) return fallback
  return DEFAULT_STYLE_ID
}

export function sanitizeWorkStylePatch(
  patch: { zcf_role?: string | null },
  settings: StyleSettings,
): { zcf_role?: string | null } {
  const next: { zcf_role?: string | null } = {}
  if (patch.zcf_role !== undefined) {
    next.zcf_role = resolveStyleId({ zcf_role: patch.zcf_role }, settings)
  }
  return next
}

export function sanitizeStyleSettingsPatch(
  input: { zcf_default_role?: string; zcf_enabled_roles?: string[]; zcf_custom_roles?: CustomStyle[] },
  settings: StyleSettings,
): { zcf_default_role?: string; zcf_enabled_roles?: string[]; zcf_custom_roles?: CustomStyle[] } {
  const customStyles = input.zcf_custom_roles !== undefined
    ? normalizeCustomStyles(input.zcf_custom_roles)
    : normalizeCustomStyles(settings.zcf_custom_roles || [])
  const candidate = input.zcf_default_role
    ?? (Array.isArray(input.zcf_enabled_roles) ? input.zcf_enabled_roles[0] : settings.zcf_default_role)
  const enabledStyles = Array.isArray(input.zcf_enabled_roles)
    ? input.zcf_enabled_roles
    : (candidate ? [candidate] : settings.zcf_enabled_roles)
  const activeStyle = normalizeEnabledStyles(enabledStyles, customStyles, candidate)[0]

  const next: { zcf_default_role?: string; zcf_enabled_roles?: string[]; zcf_custom_roles?: CustomStyle[] } = {}
  if (input.zcf_custom_roles !== undefined) next.zcf_custom_roles = customStyles
  if (
    input.zcf_default_role !== undefined
    || input.zcf_enabled_roles !== undefined
    || input.zcf_custom_roles !== undefined
  ) {
    next.zcf_default_role = activeStyle
    next.zcf_enabled_roles = [activeStyle]
  }
  return next
}

/**
 * 风格正文 → 系统提示词附录。
 *
 * 「默认」风格不注入任何内容；内置风格取自预定义常量，自定义风格取自设置。
 */
export function loadStyleContent(
  styleId: string | null | undefined,
  customStyles: CustomStyle[] = [],
): string {
  if (!styleId || styleId === DEFAULT_STYLE_ID) return ''
  const custom = customStyles.find((item) => item.id === styleId)
  const preset = findPresetStyle(styleId)
  const label = custom?.label || preset?.label
  const body = (custom?.prompt || preset?.body || '').trim()
  if (!label || !body) return ''
  return [
    '## 当前 AI 风格（必须遵守）',
    '',
    `风格：${label}`,
    '',
    '从本条 system 指令起，你的每一条面向用户的回复都必须符合该风格的语气与表达习惯。',
    '不要说明自己在切换风格；直接按该风格自然回复。',
    '禁止使用 emoji、表情符号、颜文字或装饰性 Unicode 字符。',
    '',
    body,
  ].join('\n')
}

export function composeSystemPromptWithStyle(
  core: string,
  styleId?: string | null,
  customStyles: CustomStyle[] = [],
): string {
  const appendix = loadStyleContent(styleId, customStyles)
  if (!appendix) return core
  return [
    appendix,
    '',
    '---',
    '',
    core,
    '',
    '---',
    '',
    '再次强调：你必须持续体现「当前 AI 风格」的语言习惯；若有冲突，以 WeWorker 工具与安全规则为准。',
  ].join('\n')
}
