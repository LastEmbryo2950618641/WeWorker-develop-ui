import test from 'node:test'
import assert from 'node:assert/strict'
import { getThinkingEffortOptions, normalizeThinkingEffort } from '../utils/thinking-effort.js'

test('thinking defaults to off for missing or unsupported values', () => {
  for (const value of [null, undefined, '', 'invalid']) assert.equal(normalizeThinkingEffort(value), 'off')
})

test('all provider menus offer off first and preserve a selected off value', () => {
  for (const [provider, model] of [['deepseek', 'deepseek-v4-pro'], ['custom', 'unknown'], ['anthropic', 'claude-opus-4-6']]) {
    const options = getThinkingEffortOptions(provider, model)
    assert.deepEqual(options[0], { value: 'off', label: '关' })
    assert.equal(normalizeThinkingEffort('off', options), 'off')
    assert.equal(normalizeThinkingEffort('low', options), 'low')
  }
})

test('extended effort remains available only for supported models', () => {
  assert.equal(normalizeThinkingEffort('max', getThinkingEffortOptions('anthropic', 'claude-opus-4-6')), 'max')
  assert.equal(normalizeThinkingEffort('max', getThinkingEffortOptions('custom', 'unknown')), 'off')
})
