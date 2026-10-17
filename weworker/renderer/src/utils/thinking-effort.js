const BASIC_OPTIONS = [
  { value: 'off', label: '关' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

const ADVANCED_OPTIONS = [
  ...BASIC_OPTIONS,
  { value: 'xhigh', label: '极高' },
  { value: 'max', label: '最大' },
]

// Claude 4.6 and newer models expose the extended effort levels in the SDK.
// Unknown models use off plus the portable low/medium/high set.
// Start with thinking disabled when adopting the new off-capable preference.
export const THINKING_EFFORT_STORAGE_KEY = 'weworker-thinking-effort-v2'
export function getThinkingEffortOptions(providerId, model) {
  const modelName = String(model || '').toLowerCase()
  const supportsAdvanced = providerId === 'anthropic'
    && /(?:claude-(?:opus|sonnet)-4[.-]6|claude-(?:opus|sonnet)-4[.-]7|fable)/i.test(modelName)
  return supportsAdvanced ? ADVANCED_OPTIONS : BASIC_OPTIONS
}

export function normalizeThinkingEffort(value, options = ADVANCED_OPTIONS) {
  const candidate = String(value || '').toLowerCase()
  return options.some((option) => option.value === candidate) ? candidate : 'off'
}

export { BASIC_OPTIONS }
