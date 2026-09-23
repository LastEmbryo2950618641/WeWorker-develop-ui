import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOwnerUserId, validateOwnerUserId } from '../utils/owner-user-id.js'

describe('owner-user-id', () => {
  it('accepts empty owner id', () => {
    assert.equal(validateOwnerUserId('wecom', ''), null)
    assert.equal(validateOwnerUserId('wecom', '   '), null)
  })

  it('rejects short or malformed owner ids', () => {
    assert.match(validateOwnerUserId('wecom', 'err'), /过短/)
    assert.match(validateOwnerUserId('qq', 'abc!@#'), /格式不正确/)
  })

  it('accepts typical channel owner ids', () => {
    assert.equal(validateOwnerUserId('wecom', 'fixture_owner_user_001'), null)
    assert.equal(validateOwnerUserId('weixin', 'ilink-user-001'), null)
    assert.equal(normalizeOwnerUserId(' owner-qq '), 'owner-qq')
  })
})
