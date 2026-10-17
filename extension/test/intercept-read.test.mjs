import test from 'node:test';
import assert from 'node:assert/strict';
import { executeInterceptRead, interceptJson } from '../background/intercept-read.js';
const source = { strategy: 'INTERCEPT', method: 'GET', endpoint: 'https://example.com/api/search', trigger: { kind: 'search', selector: '#q', parameter: 'keyword' }, matchQuery: { q: 'keyword' }, timeoutMs: 500 };
function harness({ route = 'https://example.com/search', status = 200, mimeType = 'application/json', body = '{"items":[{"id":"example-one"}]}', mode = 'success' } = {}) {
  const listeners = new Set(), retrieved = [], commands = [];
  let time = 0;
  const emit = async (method, params) => { for (const fn of [...listeners]) await fn({ tabId: 7 }, method, params); };
  const request = async (id, url = 'https://example.com/api/search?q=Example', method = 'GET', postData) => {
    await emit('Network.requestWillBeSent', { requestId: id, type: 'Fetch', request: { method, url, postData } });
    await emit('Network.responseReceived', { requestId: id, response: { status, mimeType } });
    await emit('Network.loadingFinished', { requestId: id });
  };
  const chrome = { tabs: { get: async () => ({ url: route }) }, debugger: {
    onEvent: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
    sendCommand: async (_tab, method, params) => { commands.push(method); if (method === 'Network.getResponseBody') { retrieved.push(params.requestId); return { body }; } return {}; },
  }, scripting: { executeScript: async () => {
    await emit('Network.responseReceived', { requestId: 'old', response: { status, mimeType } });
    await emit('Network.loadingFinished', { requestId: 'old' });
    await request('unrelated', 'https://example.com/api/search?q=Other');
    if (mode !== 'timeout') await request('new');
    if (mode === 'duplicate') await request('duplicate');
    if (mode === 'navigation') await emit('Page.frameNavigated', { frame: { id: 'main' } });
    if (mode === 'route') route = 'https://example.com/other';
    if (mode === 'action-error') return [{ result: { ok: false, error: { code: 'INTERCEPT_UNSAFE_TRIGGER', message: 'No read semantics' } } }];
    return [{ result: { ok: true } }];
  } } };
  const run = (extra = {}) => executeInterceptRead({ chrome, ensureCdpAttached: async () => {}, tabId: 7,
    payload: { source, values: { keyword: 'Example' }, expectedOrigin: 'https://example.com', expectedPath: '/search', ...extra }, now: () => time, sleep: async ms => { time += ms; } });
  return { run, listeners, retrieved, commands };
}
test('returns only fresh correlated JSON and always removes its listener', async () => {
  const h = harness();
  assert.deepEqual((await h.run()).data, { items: [{ id: 'example-one' }] });
  assert.ok(h.commands.indexOf('Page.bringToFront') < h.commands.indexOf('Network.getResponseBody'));
  assert.deepEqual(h.retrieved, ['new']); assert.equal(h.listeners.size, 0);
});
test('observation returns structural evidence without captured scalar values', async () => {
  const h = harness(); const result = await h.run({ metadataOnly: true });
  assert.equal(result.shape.properties.items.type, 'array');
  assert.equal(JSON.stringify(result).includes('example-one'), false);
});
test('rejects timeout, duplicate responses, HTTP errors, HTML, action errors and changed routes', async () => {
  for (const [options, code] of [[{ mode: 'timeout' }, 'INTERCEPT_TIMEOUT'], [{ mode: 'duplicate' }, 'INTERCEPT_AMBIGUOUS'],
    [{ status: 503 }, 'INTERCEPT_HTTP_ERROR'], [{ mimeType: 'text/html' }, 'INTERCEPT_NOT_JSON'],
    [{ mode: 'navigation' }, 'INTERCEPT_DOCUMENT_CHANGED'], [{ mode: 'action-error' }, 'INTERCEPT_UNSAFE_TRIGGER'], [{ mode: 'route' }, 'INTERCEPT_ROUTE_CHANGED']]) {
    const h = harness(options); assert.equal((await h.run()).error.code, code); assert.equal(h.listeners.size, 0);
  }
});
test('redacts credentials without truncating business rows or returning partial JSON', () => {
  const value = interceptJson('{"items":[{"title":"Example","token":"placeholder-secret"}]}');
  assert.equal(value.items[0].token, '[redacted]'); assert.equal(value.items[0].title, 'Example');
  assert.throws(() => interceptJson('{"truncated":'), /complete JSON/);
  assert.throws(() => interceptJson(JSON.stringify('x'.repeat(1000000))), /exceeds/);
});
