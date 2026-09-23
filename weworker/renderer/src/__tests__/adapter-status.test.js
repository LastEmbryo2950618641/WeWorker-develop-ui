import test from 'node:test'
import assert from 'node:assert/strict'
import { adapterPackageStatus } from '../utils/adapter-status.js'
import { useSitesStore } from '../store/sites.js'

test('reports installed package source, version and unavailable state', () => {
  assert.equal(adapterPackageStatus({}), '')
  assert.equal(adapterPackageStatus({ enabled: true, managed: { source: 'user', version: '1.2.3' } }), '用户安装 · v1.2.3')
  assert.match(adapterPackageStatus({ enabled: false, managed: { source: 'builtin', canEnable: false } }), /包不可用/)
  assert.doesNotMatch(adapterPackageStatus({ enabled: false, managed: { source: 'development', canEnable: true } }), /包不可用/)
})

test('waits for the backend, rejects duplicate toggles and reports failures without falsely enabling a package', async () => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window
  globalThis.window = { electronAPI: {} }
  const site = { id: 'demo', icon: 'globe', enabled: false, managed: { canEnable: true } }
  useSitesStore.setState({ sites: [site], togglingIds: [], toggleError: null })
  let finish, mutations = 0
  globalThis.fetch = async (url) => {
    if (url.endsWith('/toggle')) {
      mutations++
      return new Promise(resolve => { finish = resolve })
    }
    assert.ok(url.endsWith('/sites'))
    return Response.json([site])
  }
  try {
    const pending = useSitesStore.getState().toggle('demo')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(useSitesStore.getState().sites[0].enabled, false)
    assert.deepEqual(useSitesStore.getState().togglingIds, ['demo'])
    await useSitesStore.getState().toggle('demo')
    assert.equal(mutations, 1)
    finish(Response.json({ detail: 'Fixture package unavailable' }, { status: 409 }))
    await pending
    assert.equal(useSitesStore.getState().sites[0].enabled, false)
    assert.deepEqual(useSitesStore.getState().togglingIds, [])
    assert.equal(useSitesStore.getState().toggleError.message, 'Fixture package unavailable')
  } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow }
})
