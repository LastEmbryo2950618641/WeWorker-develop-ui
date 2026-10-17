import assert from 'node:assert/strict'
import { test } from 'node:test'
import { connectionMessage, explorationForm } from '../utils/model-connection.js'

test('connection failures identify the actionable cause rather than claiming protocol incompatibility', () => {
  for (const [error, text] of [['auth_failed', '密钥'], ['timeout', '超时'], ['network_error', '网络'], ['rate_limited', '限流'], ['model_unavailable', '模型']]) {
    const message = connectionMessage({ ok: false, error })
    assert.ok(message.includes(text))
    assert.ok(!message.includes('不支持'))
  }
})

test('an exploration form defaults to the detected address and never copies a key or fixes a reused model', () => {
  assert.deepEqual(explorationForm({ candidate_url: 'https://example.com/v1', model: 'main-model', api_key: 'fixture-never-copy' }), {
    base_url: 'https://example.com/v1', base_url_is_full: false, api_key: '', use_main_key: true, model: '',
  })
  assert.equal(explorationForm({ configured_model: 'exploration-model' }).model, 'exploration-model')
})

test('exploration forms preserve exact endpoints and prefer the saved URL mode', () => {
  const endpoint = 'https://example.com/custom/infer/?version=1&route=a%2Fb'
  const suggested = explorationForm({ candidate_url: endpoint, candidate_url_is_full: true })
  assert.equal(suggested.base_url, endpoint)
  assert.equal(suggested.base_url_is_full, true)
  const saved = explorationForm({ base_url: 'https://example.org/v1', base_url_is_full: false, candidate_url: endpoint, candidate_url_is_full: true })
  assert.equal(saved.base_url, 'https://example.org/v1')
  assert.equal(saved.base_url_is_full, false)
})
