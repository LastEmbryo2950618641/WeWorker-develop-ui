import { create } from 'zustand'
import { useSettingsStore } from './settings.js'

/**
 * 风格目录（纯内置提示词，与 ZCF 无关）。
 *
 * 这里只做两件事：
 *   1. 给出「默认 + 内置风格」的静态清单（正文在 Backend 的 `style-presets.ts`，
 *      Renderer 只需要 id / 文案就能绘制卡片与下拉框）；
 *   2. 提供纯函数式的 id 解析 / 回落，避免后端已删风格的残留 id（例如历史
 *      `auto-plan`）在 UI 上渲染成一张空卡片。
 *
 * 不自带请求、不做目录同步、不落盘 —— 自定义风格来自 `/settings`，由
 * `useSettingsStore` 负责加载与保存。
 *
 * id 与 Backend `PRESET_STYLES` 一一对应；这些 id 也是用户历史选择
 * （`zcf_default_role` / `zcf_enabled_roles`）里的取值，改名要数据迁移。
 */

/** 不注入任何提示词的原生模式。 */
export const DEFAULT_STYLE_ID = 'default'

/**
 * 内置风格的 id / 文案。与 `weworker/backend-ts/src/style-presets.ts` 的
 * PRESET_STYLES 对齐（正文只在 Backend 维护，这里不需要正文）。
 */
export const BUILTIN_STYLES = [
  { id: 'default', label: '默认', kind: 'default', badge: '内置', description: '原生模式，不注入任何风格提示词' },
  { id: 'weworker-clear', label: '专业严谨简单明确', kind: 'core', badge: '内置', description: '简洁直接；禁止 emoji、大标题与无意义措辞' },
  { id: 'engineer-professional', label: '工程师专业版', kind: 'core', badge: '内置', description: '专业的软件工程师，严格遵循 SOLID、KISS、DRY、YAGNI 原则' },
]

/** 只有自定义风格可编辑（内置风格的正文由应用维护）。 */
export function isCustomStyleId(styleId) {
  return typeof styleId === 'string' && styleId.startsWith('custom-')
}

/** 某个 id 是否属于内置风格（含「默认」）。 */
export function isBuiltinStyleId(styleId) {
  return BUILTIN_STYLES.some((style) => style.id === styleId)
}

/**
 * 规范化自定义风格列表：丢掉空条目、补齐 `custom-` 前缀、去重。
 * 与 Backend `normalizeCustomStyles` 同规则，但渲染层只读，不做持久化。
 */
export function normalizeCustomStyles(styles) {
  if (!Array.isArray(styles)) return []
  const seen = new Set()
  const normalized = []
  for (const raw of styles) {
    if (!raw || typeof raw !== 'object') continue
    const label = String(raw.label ?? '').trim()
    const prompt = String(raw.prompt ?? '').trim()
    if (!label || !prompt) continue
    const rawId = String(raw.id ?? '').trim()
    if (!rawId) continue
    const id = isCustomStyleId(rawId) ? rawId : `custom-${rawId}`
    if (seen.has(id)) continue
    seen.add(id)
    normalized.push({ id, label, prompt })
  }
  return normalized
}

/** 可选的完整风格列表：内置 + 自定义（已保存的，不含未落盘的草稿）。 */
export function listSelectableStyles(customStyles = []) {
  const custom = normalizeCustomStyles(customStyles).map((style) => ({
    ...style,
    kind: 'custom',
    badge: '自定义',
  }))
  return [...BUILTIN_STYLES, ...custom]
}

export function findStyleLabel(styleId, customStyles = []) {
  if (!styleId) return ''
  const custom = normalizeCustomStyles(customStyles).find((style) => style.id === styleId)
  if (custom) return custom.label
  return BUILTIN_STYLES.find((style) => style.id === styleId)?.label || ''
}

/**
 * 实际生效的风格 id：
 *   - 请求的 id 仍可选 → 用它；
 *   - 否则回落到「设置里的当前风格」（仍可选时）；
 *   - 再否则回落到「默认」。
 * 已删除风格的残留 id（`auto-plan`、`sixStep`、被删的自定义风格…）都在这里被吃掉，
 * 因此不会把无效值写回 work，也不会让下拉框出现空选项。
 */
export function resolveStyleId(styleId, customStyles = [], fallbackStyleId = DEFAULT_STYLE_ID) {
  const available = new Set(listSelectableStyles(customStyles).map((style) => style.id))
  if (styleId && available.has(styleId)) return styleId
  if (fallbackStyleId && available.has(fallbackStyleId)) return fallbackStyleId
  return DEFAULT_STYLE_ID
}

/**
 * 轻量目录 store：让聊天区「风格选择」的下拉选项与设置页共用同一份清单。
 *
 * 只做只读投影：自定义风格的加载与保存仍归 `useSettingsStore`，这里订阅它的
 * `zcfCustomRoles`（沿用历史字段名），避免两个 store 各自维护一份可能漂移的列表。
 */
export const useStylesStore = create((set, get) => ({
  styles: listSelectableStyles(useSettingsStore.getState().zcfCustomRoles),

  /** 某个 id 是否仍可选。 */
  hasStyle: (styleId) => get().styles.some((style) => style.id === styleId),

  /** 下拉框 / 提示文案里的风格名；未知 id 回落到「默认」。 */
  styleLabel: (styleId) => {
    const style = get().styles.find((item) => item.id === styleId)
    return style?.label || '默认'
  },
}))

// 已保存的自定义风格变化（首次加载 / 保存成功 / 删除）→ 刷新可选清单。
useSettingsStore.subscribe((state, previous) => {
  if (state.zcfCustomRoles === previous.zcfCustomRoles) return
  useStylesStore.setState({ styles: listSelectableStyles(state.zcfCustomRoles) })
})
