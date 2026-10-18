import test from 'node:test';
import assert from 'node:assert/strict';
import { executePageQuery } from '../background/page-query.js';
const source = { strategy: 'UI_SELECTOR', mode: 'query', trigger: { kind: 'search', parameter: 'keyword', selector: '#q', submitSelector: '#submit' },
  result: { strategy: 'UI_SELECTOR', selector: '.row' }, resultPathname: '/results', matchQuery: { q: 'keyword' }, timeoutMs: 1000 };
function setup(mode = 'navigation') {
  const listeners = new Set(), input = [];
  let time = 0, action = false, route = 'https://example.com/results?q=old';
  const chrome = { tabs: { get: async () => ({ url: route, status: 'complete' }) }, debugger: {
    onEvent: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
    sendCommand: async (_target, method) => { input.push(method); if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', loaderId: 'initial' } } }; if (method === 'Input.dispatchMouseEvent' && !action) {
      action = true; route = mode === 'wrong-origin' ? 'https://example.org/results?q=Example' : 'https://example.com/results?q=Example';
      for (const listener of listeners) listener({ tabId: 7 }, ['stale-spa', 'child-frame', 'fresh-spa'].includes(mode) ? 'Page.navigatedWithinDocument' : 'Page.frameNavigated', { frameId: mode === 'child-frame' ? 'child' : 'main', url: route, frame: { id: 'main', loaderId: 'next', url: route } });
    } },
  }, scripting: { executeScript: async ({ func, args }) => func.name === 'prepareInterceptAction' ? [{ result: { ok: true, point: { x: 20, y: 20 } } }]
    : [{ result: args[0].metadataOnly ? { ok: true, shape: { type: 'object' } } : { ok: true, data: { title: action && mode !== 'stale-spa' ? 'Example' : 'Old example' } } }] } };
  return { listeners, input, run: (extra = {}) => executePageQuery({ chrome, ensureCdpAttached: async () => {}, tabId: 7,
    payload: { source, values: { keyword: 'Example' }, expectedOrigin: 'https://example.com', expectedPath: '/start', ...extra }, now: () => time, sleep: async ms => { time += ms; } }) };
}
test('navigation query survives a replaced document, reads fresh data and cleans its listener', async () => {
  const f = setup(); assert.deepEqual((await f.run()).data, { title: 'Example' }); assert.equal(f.listeners.size, 0);
  assert.equal(f.input.filter(method => method === 'Input.dispatchMouseEvent').length, 3);
});
test('observation emits only shape; stale SPA data, wrong-origin navigation and invalid arguments fail', async () => {
  assert.deepEqual(await setup().run({ metadataOnly: true }), { ok: true, shape: { type: 'object' } });
  for (const [mode, code] of [['stale-spa', 'PAGE_QUERY_TIMEOUT'], ['child-frame', 'PAGE_QUERY_TIMEOUT'], ['wrong-origin', 'PAGE_QUERY_ORIGIN_CHANGED']]) {
    const f = setup(mode); assert.equal((await f.run()).error.code, code); assert.equal(f.listeners.size, 0);
  }
  const f = setup(); assert.equal((await f.run({ values: {} })).error.code, 'INVALID_PAGE_QUERY_ARGUMENT'); assert.equal(f.input.length, 0);
});
test('main-frame SPA query requires changed results and ignores child-frame history', async () => {
  assert.deepEqual((await setup('fresh-spa').run()).data, { title: 'Example' });
});
