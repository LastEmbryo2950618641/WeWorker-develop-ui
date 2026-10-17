// AppDropdownSelect 的纯逻辑：作用域过滤与自定义值构造。
// 这里只放纯函数，便于在裸 node --test 环境下直接单测。

function toText(input) {
  return String(input ?? '')
}

/**
 * 按关键字过滤下拉选项。
 * - 空 query（或只有空白）原样返回入参，保持未搜索时的既有行为；
 * - 非空 query 大小写不敏感，匹配 label 或 value 的子串；
 * - 保持原顺序、不修改入参。
 */
export function filterDropdownOptions(options, query) {
  if (!Array.isArray(options)) return []
  const keyword = toText(query).trim().toLowerCase()
  if (!keyword) return options
  return options.filter((option) => {
    if (!option || typeof option !== 'object') return false
    const label = toText(option.label).toLowerCase()
    const value = toText(option.value).toLowerCase()
    return label.includes(keyword) || value.includes(keyword)
  })
}

/**
 * 构造「自定义选项」：当输入去空白后非空，且没有任何已有 value 与之完全相等时返回该项。
 * 返回 null 表示不应该出现自定义项（输入为空，或与已有选项重复）。
 */
export function buildCustomOption(query, options) {
  const trimmed = toText(query).trim()
  if (!trimmed) return null
  const list = Array.isArray(options) ? options : []
  const duplicated = list.some((option) => toText(option?.value) === trimmed)
  if (duplicated) return null
  return { value: trimmed, label: trimmed, custom: true }
}
