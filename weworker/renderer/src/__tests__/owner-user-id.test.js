import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOwnerUserId, validateOwnerUserId, getOwnerPermissionSelection, hasUnsavedOwnerPermission } from '../utils/owner-user-id.js'

describe('owner-user-id', () => {
  it('does not mark an entered owner and full permission as saved before server confirmation', () => {
    const saved = { owner_user_id: '', owner_permission_level: 'qa_only' }
    assert.equal(hasUnsavedOwnerPermission('fixture-owner', 'full', saved), true)
    assert.equal(hasUnsavedOwnerPermission('fixture-owner', 'full', { owner_user_id: 'fixture-owner', owner_permission_level: 'full' }), false)
  })
  it('marks owner changes, permission changes and owner removal as pending', () => {
    const saved = { owner_user_id: 'fixture-owner', owner_permission_level: 'full' }
    assert.equal(hasUnsavedOwnerPermission('fixture-other', 'full', saved), true)
    assert.equal(hasUnsavedOwnerPermission('fixture-owner', 'qa_only', saved), true)
    assert.equal(hasUnsavedOwnerPermission('', 'qa_only', saved), true)
    assert.equal(hasUnsavedOwnerPermission(' fixture-owner ', 'full', saved), false)
    assert.equal(hasUnsavedOwnerPermission('', 'qa_only', {}), false)
  })
  it('defaults missing or ownerless legacy permissions to QA and preserves explicit owner grants', () => {
    assert.equal(getOwnerPermissionSelection('', 'full'), 'qa_only')
    assert.equal(getOwnerPermissionSelection('fixture-owner'), 'qa_only')
    assert.equal(getOwnerPermissionSelection('fixture-owner', 'invalid'), 'qa_only')
    assert.equal(getOwnerPermissionSelection('fixture-owner', 'full'), 'full')
    assert.equal(getOwnerPermissionSelection('fixture-owner', 'no_bash'), 'no_bash')
  })
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
