import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { executePageRequest, pageJsonRequest } from '../background/page-write.js';

const origin = 'https://example.com';
const idempotency = { header: 'idempotency-key', key: 'a'.repeat(64) };
const route = { origin, pathname: '/editor' };
const request = { url: origin + '/items/example', method: 'POST', body: { title: 'After' } };
function fixture(mode) {
  const calls = []; let frames = 0;
  const chrome = { tabs: { get: async () => ({ url: origin + '/editor' }) }, debugger: { sendCommand: async (_target, method, params) => {
    calls.push({ method, params });
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', loaderId: mode === 'changed' && ++frames > 1 ? 'other' : 'first', url: origin + '/editor' } } };
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 };
    if (method === 'Runtime.evaluate' && params.expression.includes('async function pageJsonRequest')) {
      if (mode === 'lost') throw new Error('Example lost reply');
      if (mode === 'hung') return new Promise(() => {});
      return { result: { value: { ok: true, value: { title: 'After' } } } };
    }
  } } };
  return { calls, run: (payload = {}, extra = {}) => executePageRequest({ chrome, tabId: 7, ensureCdpAttached: async () => {},
    payload: { route, request, idempotency, confirmed: true, deadline: Date.now() + 1000, ...payload }, ...extra }) };
}
test('dispatches once in the retained isolated document and returns its identity', async () => {
  const f = fixture(); const reply = await f.run();
  assert.equal(reply.ok, true); assert.equal(reply.dispatched, true); assert.equal(reply.document.loaderId, 'first');
  assert.equal(f.calls.filter(call => call.method === 'Runtime.evaluate' && call.params.expression.includes('async function pageJsonRequest')).length, 1);
  assert.equal(f.calls.find(call => call.method === 'Runtime.evaluate' && call.params.expression.includes('async function pageJsonRequest')).params.contextId, 1);
});
test('confirmation, origin, document drift, expiry and cancellation reject before dispatch', async () => {
  for (const payload of [{ confirmed: false }, { deadline: Date.now() - 1 }, { request: { ...request, url: 'https://example.org/items/example' } },
    { idempotency: null }, { idempotency: { header: 'authorization', key: 'a'.repeat(64) } },
    { expectedDocument: { frameId: 'main', loaderId: 'other', url: origin + '/editor' } }]) {
    const f = fixture(); assert.equal((await f.run(payload)).dispatched, false);
    assert.ok(!f.calls.some(call => call.method === 'Runtime.evaluate' && call.params.expression.includes('async function pageJsonRequest')));
  }
  const changed = fixture('changed'); assert.equal((await changed.run()).error.code, 'PAGE_WRITE_DOCUMENT_CHANGED');
  const cancelled = fixture(); assert.equal((await cancelled.run({}, { assertRunning: () => { throw new Error('Example cancelled'); } })).dispatched, false);
});
test('lost responses and timeouts never repeat application dispatch; stalled preflight cannot send a late write', async () => {
  for (const mode of ['lost', 'hung']) {
    const f = fixture(mode); assert.equal((await f.run({ deadline: Date.now() + 30 })).dispatched, true);
    assert.equal(f.calls.filter(call => call.method === 'Runtime.evaluate' && call.params.expression.includes('async function pageJsonRequest')).length, 1);
  }
  const f = fixture(); let release;
  const result = await f.run({ deadline: Date.now() + 30 }, { ensureCdpAttached: () => new Promise(resolve => { release = resolve; }) });
  assert.equal(result.dispatched, false); release(); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(f.calls.length, 0);
});
test('injected function makes one fetch call with credentials/idempotency, no redirects/cache and bounded JSON errors', async () => {
  const calls = [];
  const execute = async response => {
    const context = vm.createContext({ __weworkerWriteDocumentToken: 'example-document', location: { href: origin + '/editor' }, Date, AbortController, setTimeout, clearTimeout, TextDecoder,
      fetch: async (...args) => { calls.push(args); if (response instanceof Error) throw response; return response; } });
    return await vm.runInContext(`(${pageJsonRequest.toString()})(${JSON.stringify({ documentUrl: origin + '/editor', documentToken: 'example-document', request, idempotency, timeoutMs: 100, deadline: Date.now() + 1000 })})`, context);
  };
  assert.equal((await execute(new Response('{"title":"After"}'))).value.title, 'After');
  assert.equal(calls[0][1].headers['idempotency-key'], idempotency.key);
  assert.equal(calls[0][1].credentials, 'same-origin'); assert.equal(calls[0][1].redirect, 'error'); assert.equal(calls[0][1].cache, 'no-store');
  for (const [response, code] of [[new Response('{}', { status: 409 }), 'PAGE_WRITE_HTTP_STATUS'], [new Response('not JSON'), 'PAGE_WRITE_INVALID_JSON'],
    [new Response('x'.repeat(4 * 1024 * 1024 + 1)), 'PAGE_WRITE_RESPONSE_LIMIT'], [new Error('Example failure'), 'PAGE_WRITE_NETWORK_ERROR']]) assert.equal((await execute(response)).error.code, code);
  assert.equal(calls.length, 5);
});

test('same-URL replacement context or a late evaluation cannot dispatch a request', async () => {
  for (const state of [{ marker: 'other-document', deadline: Date.now() + 1000 }, { marker: 'expected-document', deadline: Date.now() - 1 }]) {
    let requests = 0;
    const context = vm.createContext({ location: { href: origin + '/editor' }, __weworkerWriteDocumentToken: state.marker,
      AbortController, setTimeout, clearTimeout, TextDecoder, fetch: () => { requests++; throw new Error('Must not request'); } });
    const reply = await vm.runInContext(`(${pageJsonRequest.toString()})(${JSON.stringify({ documentUrl: origin + '/editor', documentToken: 'expected-document', request, idempotency, timeoutMs: 100, deadline: state.deadline })})`, context);
    assert.equal(reply.ok, false); assert.equal(requests, 0);
  }
});
