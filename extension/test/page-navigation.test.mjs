import test from 'node:test';
import assert from 'node:assert/strict';
import { executePageQuery } from '../background/page-query.js';
import { matchesPagePath, assertPageQueryRoute, resolvePageDestination } from '../background/page-navigation.js';

const source = { strategy: 'UI_SELECTOR', mode: 'navigate', resultPathname: '/items/:id', timeoutMs: 1000,
  pathParameters: [{ segmentIndex: 1, name: 'itemId', description: 'Public item identifier' }], result: { strategy: 'DOM_STATE', path: ['exampleItem'] } };
const payload = { version: 1, source, expectedOrigin: 'https://example.com', expectedPath: '/start', values: { itemId: '007' } };
function setup(mode = 'success') {
  let time = 0, route = 'https://example.com/start', data = 'Old example', lagReads = 0, lastSnapshot;
  const listeners = new Set(), calls = [];
  const chrome = { tabs: { get: async () => ({ url: lastSnapshot = lagReads-- > 0 ? 'https://example.com/start' : route, status: 'complete' }) }, debugger: {
    onEvent: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
    sendCommand: async (_target, method, args) => {
      calls.push(method);
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', loaderId: 'initial' } } };
      if (method === 'Page.navigate') {
        if (mode === 'hung') return new Promise(() => {});
        route = mode === 'origin' ? 'https://example.org/items/007' : mode === 'redirect' ? 'https://example.com/items/008' : args.url;
        data = 'Example 007';
        if (mode === 'summary-lag') lagReads = 2;
        if (mode === 'summary-stuck' || mode === 'summary-redirect') lagReads = Infinity;
        if (mode === 'summary-redirect') route = 'https://other.example.org/items/007';
        if (mode !== 'no-event') for (const fn of listeners) fn({ tabId: 7 }, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'new', url: route } });
        return { loaderId: 'new' };
      }
    },
  }, scripting: { executeScript: async ({ args }) => {
    calls.push(lastSnapshot === 'https://example.com/start' ? 'stale-read' : 'read');
    assert.notEqual(lastSnapshot, 'https://example.com/start', 'must not read the pending old snapshot');
    if (mode === 'changed-read') for (const fn of listeners) fn({ tabId: 7 }, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'changed-' + time, url: route } });
    return [{ result: args[0].metadataOnly ? { ok: true, shape: { type: 'object' } } : { ok: true, data: { title: data } } }];
  } } };
  return { calls, listeners, run: (extra = {}) => executePageQuery({ chrome, ensureCdpAttached: async () => {}, tabId: 7, payload: { ...payload, ...extra }, now: () => time, sleep: async ms => { time += ms; } }) };
}
test('navigates once, waits for a new document and stable data, and omits data from observations', async () => {
  const f = setup(); assert.deepEqual((await f.run()).data, { title: 'Example 007' });
  assert.equal(f.calls.filter(method => method === 'Page.navigate').length, 1); assert.equal(f.listeners.size, 0);
  assert.deepEqual(await setup().run({ metadataOnly: true }), { ok: true, shape: { type: 'object' } });
});
test('navigation never replays after wrong origin, wrong identifier or missing document event', async () => {
  for (const [mode, code] of [['origin', 'PAGE_QUERY_ORIGIN_CHANGED'], ['redirect', 'PAGE_QUERY_ROUTE_CHANGED'], ['no-event', 'PAGE_QUERY_TIMEOUT'], ['changed-read', 'PAGE_QUERY_TIMEOUT']]) {
    const f = setup(mode); assert.equal((await f.run()).error.code, code); assert.equal(f.calls.filter(method => method === 'Page.navigate').length, 1); assert.equal(f.listeners.size, 0);
  }
  const f = setup(); assert.equal((await f.run({ values: { itemId: '../007' } })).error.code, 'INVALID_PAGE_QUERY_ARGUMENT'); assert.equal(f.calls.length, 0);
});
test('path-family selection and continuation validation preserve manifest origin, template and bindings', () => {
  assert.ok(matchesPagePath('/items/007', '/items/:id'));
  for (const path of ['/items/', '/items/%2F', '/items/007/extra', '/items/%2e%2e', '/items/:id']) assert.equal(matchesPagePath(path, '/items/:id'), false);
  assert.equal(resolvePageDestination(payload.expectedOrigin, source, { itemId: '示例' }).pathname, '/items/%E7%A4%BA%E4%BE%8B');
  const command = { safety: 'read', pageWorkflow: true, pageRoute: { origin: payload.expectedOrigin, pathname: '/start', navigation: { pathname: source.resultPathname, pathParameters: source.pathParameters } } };
  assert.equal(assertPageQueryRoute(payload, command), 'https://example.com/items/007');
  for (const changed of [{ ...payload, expectedOrigin: 'https://example.org' }, { ...payload, source: { ...source, resultPathname: '/other/:id' } }, { ...payload, source: { ...source, pathParameters: [] } }]) assert.throws(() => assertPageQueryRoute(changed, command));
});

test('a hung CDP navigation releases the task and listener at timeout without replay', async () => {
  const f = setup('hung'); assert.equal((await f.run()).error.code, 'PAGE_QUERY_TIMEOUT');
  assert.equal(f.calls.filter(method => method === 'Page.navigate').length, 1); assert.equal(f.listeners.size, 0);
});

test('query navigation encodes each literal value once and binds exact query keys to the manifest', async () => {
  const query = { ...source, resultPathname: '/items', pathParameters: [], queryParameters: [{ name: 'keyword', queryKey: 'q', description: 'Public query' }] };
  const value = '007 &示例+?#%';
  const next = { ...payload, source: query, values: { keyword: value } };
  const command = { safety: 'read', pageWorkflow: true, pageRoute: { origin: payload.expectedOrigin, pathname: '/start', navigation: { pathname: '/items', pathParameters: [], queryParameters: query.queryParameters } } };
  const destination = new URL(assertPageQueryRoute(next, command));
  assert.equal(destination.searchParams.get('q'), value); assert.equal(destination.hash, '');
  assert.throws(() => assertPageQueryRoute({ ...next, source: { ...query, queryParameters: [{ ...query.queryParameters[0], queryKey: 'other' }] } }, command));
  const f = setup(); assert.equal((await f.run({ source: query, values: { keyword: value } })).ok, true);
  assert.equal(f.calls.filter(method => method === 'Page.navigate').length, 1);
  const redirect = setup('redirect'); assert.equal((await redirect.run({ source: query, values: { keyword: value } })).error.code, 'PAGE_QUERY_ROUTE_CHANGED');
});

test('declared destination origins preserve exact route guards and do not authorize other origins', async () => {
  const cross = { ...source, resultOrigin: 'https://example.org' }, f = setup();
  assert.equal((await f.run({ source: cross })).ok, true);
  assert.equal(f.calls.filter(method => method === 'Page.navigate').length, 1);
  const command = { safety: 'read', pageWorkflow: true, pageRoute: { origin: payload.expectedOrigin, pathname: '/start', navigation: { pathname: source.resultPathname, pathParameters: source.pathParameters, resultOrigin: 'https://example.org' } } };
  assert.equal(assertPageQueryRoute({ ...payload, source: cross }, command), 'https://example.org/items/007');
  assert.throws(() => assertPageQueryRoute(payload, command));
  assert.throws(() => assertPageQueryRoute({ ...payload, source: { ...cross, resultOrigin: 'https://other.example.org' } }, command));
  assert.equal((await setup('redirect').run({ source: cross })).error.code, 'PAGE_QUERY_ORIGIN_CHANGED');
});

test('waits for a lagging old tabs snapshot after a cross-origin CDP commit without reading it or replaying', async () => {
  const f = setup('summary-lag');
  const actual = await f.run({ source: { ...source, resultOrigin: 'https://example.org' } });
  assert.equal(actual.ok, true); assert.deepEqual(actual.data, { title: 'Example 007' });
  assert.equal(f.calls.includes('stale-read'), false);
  assert.equal(f.calls.filter(method => method === 'Page.navigate').length, 1);
  assert.equal(f.listeners.size, 0);
});

test('an old snapshot cannot hide a CDP redirect or turn a never-updated URL into a result', async () => {
  for (const [mode, code] of [['summary-stuck', 'PAGE_QUERY_TIMEOUT'], ['summary-redirect', 'PAGE_QUERY_ORIGIN_CHANGED']]) {
    const f = setup(mode), actual = await f.run({ source: { ...source, resultOrigin: 'https://example.org' } });
    assert.equal(actual.error.code, code); assert.equal(f.calls.some(method => method.endsWith('read')), false);
    assert.equal(f.calls.filter(method => method === 'Page.navigate').length, 1); assert.equal(f.listeners.size, 0);
  }
});
