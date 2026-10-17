import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findClosestHistoryMessageIndex, getHistoryMessagePreview } from '../utils/message-history-navigation.js'

describe('message history navigation', () => {
  it('finds the nearest message around the active scroll position', () => {
    const tops = [-80, 20, 140, 260]
    assert.equal(findClosestHistoryMessageIndex(tops.length, index => tops[index], 75), 1)
    assert.equal(findClosestHistoryMessageIndex(tops.length, index => tops[index], 210), 3)
  })

  it('handles empty and out-of-range positions', () => {
    assert.equal(findClosestHistoryMessageIndex(0, () => 0, 10), -1)
    assert.equal(findClosestHistoryMessageIndex(3, index => index * 100, -20), 0)
    assert.equal(findClosestHistoryMessageIndex(3, index => index * 100, 400), 2)
  })

  it('builds a compact preview from text blocks and supplies an empty-message label', () => {
    assert.equal(getHistoryMessagePreview({
      role: 'user',
      content: [{ type: 'text', text: '  hello\nworld ' }, { type: 'tool_use', name: 'Read' }],
    }), 'hello world')
    assert.equal(getHistoryMessagePreview({ role: 'assistant', content: [] }), '助手消息')
  })

  it('truncates long previews', () => {
    assert.equal(getHistoryMessagePreview({ role: 'user', content: [{ type: 'text', text: 'abcdefgh' }] }, 4), 'abcd…')
  })
})
