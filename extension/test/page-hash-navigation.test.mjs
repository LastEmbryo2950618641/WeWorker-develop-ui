import test from 'node:test';
import assert from 'node:assert/strict';
import { executePageQuery, cancelAllPageWorkflows } from '../background/page-query.js';
const hashNavigation = { template: 'items/:id', pathParameters: [{ segmentIndex: 1, name: 'itemId', description: 'Public ID' }], matchResult: { 'item.id': 'itemId' }, freshnessPath: 'revision', sameTarget: 'reload' };
function setup(mode = 'success') {
  let time = 0, url = 'https://example.com/app#items/old', loaderId = 'original', readCount = 0;
  let data = { item: { id: 'old', title: 'Old' }, revision: 1 };
  if (mode.startsWith('repeat')) { url = 'https://example.com/app#items/007'; data.item.id = '007'; }
  if (mode === 'entry') url = 'https://example.com/entry';
  if (mode === 'missing-stamp') delete data.revision;
  const calls = [], listeners = new Set();
  const emit = (method, params) => { for (const fn of listeners) fn({ tabId: 7 }, method, params); };
  const chrome = { tabs: { get: async () => ({ url, status: 'complete' }) }, debugger: { onEvent: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
    sendCommand: async (_target, method, args) => {
      calls.push({ method, args });
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', loaderId, url } } };
      if (['Page.navigate', 'Page.reload'].includes(method)) {
        if (mode === 'hung') return new Promise(() => {});
        url = args.url || url;
        if (mode === 'redirect') url += 'wrong';
        if (mode === 'origin') url = 'https://example.org/app#items/007';
        if (mode !== 'stale') data = { item: { id: mode === 'wrong-id' ? '008' : '007', title: 'New' }, revision: mode.endsWith('unchanged-stamp') ? 1 : 2 };
        if (method === 'Page.reload' || mode === 'entry') {
          if (mode !== 'repeat-no-document') { loaderId = 'new'; emit('Page.frameNavigated', { frame: { id: 'main', loaderId, url } }); }
        } else emit('Page.navigatedWithinDocument', { frameId: 'main', url });
        if (mode === 'disconnect') cancelAllPageWorkflows();
        return {};
      }
    } }, scripting: { executeScript: async () => {
      readCount++;
      if (mode === 'document-replaced' && readCount > 1) loaderId = 'unexpected';
      return [{ result: { ok: true, data: structuredClone(data) } }];
    } } };
  return { calls, listeners, run: (extra = {}) => executePageQuery({ chrome, ensureCdpAttached: async () => {}, tabId: 7,
    payload: { version: 1, source: { strategy: 'UI_SELECTOR', mode: 'navigate', resultPathname: '/app', pathParameters: [], hashNavigation, timeoutMs: 1000, result: { strategy: 'DOM_STATE', path: ['publicResult'] } }, expectedOrigin: 'https://example.com', expectedPath: '/entry', values: { itemId: '007' }, ...extra },
    now: () => time, sleep: async ms => { time += ms; } }) };
}
test('hash navigation requires correlated fresh business data and returns structure-only observations', async () => {
  const f = setup(); assert.equal((await f.run()).data.item.title, 'New');
  assert.equal(f.calls.filter(item => item.method === 'Page.navigate').length, 1); assert.equal(f.listeners.size, 0);
  const result = await setup().run({ metadataOnly: true }); assert.equal(result.shape.type, 'object'); assert.equal(result.data, undefined);
});
test('equal hash target explicitly reloads once and requires a new document, while entry navigation works', async () => {
  for (const mode of ['repeat', 'entry']) {
    const f = setup(mode); assert.equal((await f.run()).ok, true);
    assert.equal(f.calls.filter(item => ['Page.reload', 'Page.navigate'].includes(item.method)).length, 1);
    if (mode === 'repeat') assert.deepEqual(f.calls.find(item => item.method === 'Page.reload').args, { ignoreCache: true });
  }
  const f = setup('repeat-no-document'); assert.equal((await f.run()).error.code, 'PAGE_QUERY_TIMEOUT'); assert.equal(f.listeners.size, 0);
});
test('stale, wrong, interrupted, redirected and replaced hash results never succeed or replay', async () => {
  for (const [mode, code] of [['stale', 'PAGE_QUERY_TIMEOUT'], ['unchanged-stamp', 'PAGE_QUERY_TIMEOUT'], ['repeat-unchanged-stamp', 'PAGE_QUERY_TIMEOUT'], ['wrong-id', 'PAGE_QUERY_TIMEOUT'], ['missing-stamp', 'PAGE_HASH_FRESHNESS_UNAVAILABLE'],
    ['origin', 'PAGE_QUERY_ORIGIN_CHANGED'], ['redirect', 'PAGE_QUERY_ROUTE_CHANGED'], ['document-replaced', 'PAGE_QUERY_ROUTE_CHANGED'], ['disconnect', 'PAGE_WORKFLOW_CANCELLED'], ['hung', 'PAGE_QUERY_TIMEOUT']]) {
    const f = setup(mode); const result = await f.run(); assert.equal(result.error?.code, code, mode + JSON.stringify(result));
    assert.equal(f.calls.filter(item => ['Page.reload', 'Page.navigate'].includes(item.method)).length, mode === 'missing-stamp' ? 0 : 1); assert.equal(f.listeners.size, 0);
  }
});
