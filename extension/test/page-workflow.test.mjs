import test from 'node:test';
import assert from 'node:assert/strict';
import { executePageQuery, cancelPageWorkflow, cancelAllPageWorkflows } from '../background/page-query.js';
import { pageWorkflowContract, executePageWorkflow } from '../background/page-workflow.js';
import { assertPageQueryRoute } from '../background/page-navigation.js';
const result = { strategy: 'DOM_STATE', path: ['publicResults'] };
const source = { strategy: 'UI_SELECTOR', mode: 'workflow', result, resultPathname: '/search', timeoutMs: 5000, steps: [
  { pathname: '/entry', query: { strategy: 'UI_SELECTOR', mode: 'navigate', result, resultPathname: '/search', pathParameters: [], timeoutMs: 1000 } },
  { pathname: '/search', query: { strategy: 'UI_SELECTOR', mode: 'filter', result, resultPathname: '/search', trigger: { kind: 'filter', selector: '#category', parameter: 'category' }, matchResult: { category: 'category' }, timeoutMs: 1000 } },
  { pathname: '/search', query: { strategy: 'UI_SELECTOR', mode: 'filter', result, resultPathname: '/search', trigger: { kind: 'search', selector: '#q', parameter: 'keyword' }, matchResult: { keyword: 'keyword' }, timeoutMs: 1000 } },
] };
const payload = { version: 1, source, expectedOrigin: 'https://example.com', expectedPath: '/entry', values: { category: 'books', keyword: '007' } };
function setup(mode) {
  let time = 0, route = 'https://example.com/entry', loaderId = 'initial', data = { category: 'initial', keyword: '' };
  const calls = [], actions = [], listeners = new Set();
  const operationId = '00000000-0000-4000-8000-000000000001';
  const navigate = () => { loaderId = 'new-' + time; for (const fn of listeners) fn({ tabId: 9 }, 'Page.frameNavigated', { frame: { id: 'main', loaderId, url: route } }); };
  const chrome = { tabs: { get: async () => ({ url: route, status: 'complete' }) }, debugger: {
    onEvent: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
    sendCommand: async (_target, method, args) => {
      calls.push(method);
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', loaderId } } };
      if (method === 'Page.navigate') { route = args.url; navigate(); return { loaderId: 'new' }; }
    },
  }, scripting: { executeScript: async ({ func, args }) => {
    const input = args[0];
    if (func.name === 'prepareInterceptAction') {
      const name = input.source.trigger.parameter; actions.push(name);
      if (mode !== 'stale') data[name] = input.values[name];
      if (mode === 'changed-document') navigate();
      if (mode === 'cancel') cancelPageWorkflow(9, operationId);
      if (mode === 'disconnect') cancelAllPageWorkflows();
      return [{ result: { ok: true } }];
    }
    return [{ result: input.metadataOnly ? { ok: true, shape: { type: 'object' } } : { ok: true, data: { ...data } } }];
  } } };
  return { actions, calls, listeners, run: (extra = {}) => executePageQuery({ chrome, ensureCdpAttached: async () => {}, tabId: 9,
    payload: { ...payload, ...(mode === 'cancel' ? { operationId } : {}), ...extra }, now: () => time, sleep: async ms => { time += ms; } }) };
}
test('executes every step once with correlated results and exposes only final metadata in observations', async () => {
  const f = setup(); const output = await f.run();
  assert.deepEqual(output.data, { category: 'books', keyword: '007' }); assert.equal(output.workflow.completedSteps, 3);
  assert.deepEqual(f.actions, ['category', 'keyword']); assert.equal(f.calls.filter(x => x === 'Page.navigate').length, 1); assert.equal(f.listeners.size, 0);
  const observed = await setup().run({ metadataOnly: true }); assert.equal(observed.data, undefined); assert.deepEqual(observed.shape, { type: 'object' });
  assert.equal(output.internalWorkflowPage, undefined);
});
test('a new document or changed URL between steps prevents the next action', async () => {
  for (const changedUrl of [true, false]) {
    let route = payload.expectedOrigin + '/entry', calls = 0;
    const chrome = { tabs: { get: async () => ({ url: route }) }, debugger: { sendCommand: async () => ({ frameTree: { frame: { id: 'main', loaderId: changedUrl ? 'completed' : 'replaced' } } }) } };
    const output = await executePageWorkflow({ chrome, tabId: 9, payload, now: () => 0, assertRunning() {} }, async () => {
      calls++; route = payload.expectedOrigin + (changedUrl ? '/search?q=other' : '/search');
      return { ok: true, data: {}, internalWorkflowPage: { url: payload.expectedOrigin + '/search', frameId: 'main', loaderId: 'completed' } };
    });
    assert.equal(output.error.code, 'PAGE_QUERY_ROUTE_CHANGED'); assert.equal(output.error.completedSteps, 1); assert.equal(calls, 1);
  }
});
test('stale results, document changes and cancellation stop subsequent steps without replay', async () => {
  for (const [mode, code] of [['stale', 'PAGE_QUERY_TIMEOUT'], ['changed-document', 'PAGE_QUERY_ROUTE_CHANGED'], ['cancel', 'PAGE_WORKFLOW_CANCELLED'], ['disconnect', 'PAGE_WORKFLOW_CANCELLED']]) {
    const f = setup(mode), output = await f.run();
    assert.equal(output.error.code, code); assert.equal(output.error.stepIndex, 1); assert.equal(output.error.completedSteps, 1);
    assert.deepEqual(f.actions, ['category']); assert.equal(f.calls.filter(x => x === 'Page.navigate').length, 1); assert.equal(f.listeners.size, 0);
  }
});
test('rejects invalid later arguments before the first action and enforces a total workflow budget', async () => {
  const f = setup(); assert.equal((await f.run({ values: { category: 'books' } })).error.code, 'INVALID_PAGE_QUERY_ARGUMENT'); assert.equal(f.calls.length, 0);
  const short = setup(); const output = await short.run({ source: { ...source, timeoutMs: 1000 } });
  assert.equal(output.error.code, 'PAGE_WORKFLOW_TIMEOUT'); assert.equal(output.error.completedSteps, 1); assert.equal(short.actions.length, 0);
});
test('manifest guard prevents reordered, replaced or skipped actions while allowing result selector repairs', () => {
  const command = { safety: 'read', pageWorkflow: true, pageRoute: { origin: payload.expectedOrigin, pathname: '/entry', workflow: pageWorkflowContract(source) } };
  assert.equal(assertPageQueryRoute(payload, command), 'https://example.com/entry');
  for (const steps of [source.steps.slice(1), [...source.steps].reverse(), source.steps.map((step, i) => i === 1 ? { ...step, query: { ...step.query, trigger: { ...step.query.trigger, selector: '#other' } } } : step)]) assert.throws(() => assertPageQueryRoute({ ...payload, source: { ...source, steps } }, command));
  const steps = source.steps.map(step => ({ ...step, query: { ...step.query, result: { strategy: 'DOM_STATE', path: ['changedResults'] } } }));
  assert.equal(assertPageQueryRoute({ ...payload, source: { ...source, steps } }, command), 'https://example.com/entry');
});
