import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCustomOption, filterDropdownOptions } from '../utils/dropdown-select.js'

const options = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', description: '快速模型' },
  { value: 'deepseek-chat', label: 'DeepSeek Chat' },
  { value: 'claude-sonnet', label: 'Claude Sonnet', disabled: true },
]

test('空 query 原样返回选项，不做过滤', () => {
  assert.equal(filterDropdownOptions(options, ''), options)
  assert.equal(filterDropdownOptions(options, '   '), options)
  assert.equal(filterDropdownOptions(options, null), options)
  assert.equal(filterDropdownOptions(options, undefined), options)
})

test('匹配大小写不敏感，且支持子串', () => {
  assert.deepEqual(filterDropdownOptions(options, 'DEEPSEEK').map((item) => item.value), ['deepseek-chat'])
  assert.deepEqual(filterDropdownOptions(options, 'turbo').map((item) => item.value), ['gpt-3.5-turbo'])
  assert.deepEqual(filterDropdownOptions(options, '  gpt  ').map((item) => item.value), ['gpt-4o', 'gpt-3.5-turbo'])
})

test('label 与 value 都能命中', () => {
  const mixed = [
    { value: 'provider-a/model-x', label: '模型甲' },
    { value: 'plain', label: 'Display Name 乙' },
  ]
  // value 命中（label 中不含该片段）
  assert.deepEqual(filterDropdownOptions(mixed, 'provider-a/').map((item) => item.value), ['provider-a/model-x'])
  // label 命中（value 中不含该片段）
  assert.deepEqual(filterDropdownOptions(mixed, 'Display').map((item) => item.value), ['plain'])
})

test('过滤保持原顺序且不修改入参', () => {
  const snapshot = JSON.parse(JSON.stringify(options))
  const filtered = filterDropdownOptions(options, 'gpt')
  assert.deepEqual(filtered.map((item) => item.value), ['gpt-4o', 'gpt-3.5-turbo'])
  assert.notEqual(filtered, options)
  assert.deepEqual(options, snapshot)
  // 命中 disabled 选项时也照常返回，由组件决定是否可选
  assert.deepEqual(filterDropdownOptions(options, 'claude').map((item) => item.value), ['claude-sonnet'])
})

test('无命中返回空数组，非数组入参安全返回空数组', () => {
  assert.deepEqual(filterDropdownOptions(options, 'no-such-model'), [])
  assert.deepEqual(filterDropdownOptions(null, 'gpt'), [])
  assert.deepEqual(filterDropdownOptions(undefined, 'gpt'), [])
  assert.deepEqual(filterDropdownOptions('not-an-array', 'gpt'), [])
})

test('自定义项：输入不重复的值时生成', () => {
  assert.deepEqual(buildCustomOption('my-model', options), { value: 'my-model', label: 'my-model', custom: true })
  assert.deepEqual(buildCustomOption('  my-model  ', options), { value: 'my-model', label: 'my-model', custom: true })
})

test('自定义项：空 query 不生成', () => {
  assert.equal(buildCustomOption('', options), null)
  assert.equal(buildCustomOption('   ', options), null)
  assert.equal(buildCustomOption(null, options), null)
  assert.equal(buildCustomOption(undefined, options), null)
})

test('自定义项：与已有 value 完全相等时不生成', () => {
  assert.equal(buildCustomOption('gpt-4o', options), null)
  assert.equal(buildCustomOption('  gpt-4o  ', options), null)
  // 大小写不同视为不同值，允许作为自定义项
  assert.deepEqual(buildCustomOption('GPT-4O', options), { value: 'GPT-4O', label: 'GPT-4O', custom: true })
})

test('自定义项：无选项或非数组入参时仍可生成', () => {
  assert.deepEqual(buildCustomOption('my-model', []), { value: 'my-model', label: 'my-model', custom: true })
  assert.deepEqual(buildCustomOption('my-model', null), { value: 'my-model', label: 'my-model', custom: true })
  assert.equal(buildCustomOption('my-model', [{ value: 'my-model' }]), null)
})
