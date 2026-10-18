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

function controlFixture({ repeat = {}, responses, when = true, metadataOnly = false, replaceAt, cancelAt } = {}) {
  const route = 'https://example.com/search', page = { url: route, frameId: 'main', loaderId: 'completed' };
  const query = { strategy: 'UI_SELECTOR', mode: 'filter', result, resultPathname: '/search', trigger: { kind: 'pagination', selector: '#next' }, timeoutMs: 2000 };
  const controlled = { strategy: 'UI_SELECTOR', resultPathname: '/search', result, mode: 'workflow', timeoutMs: 15000, steps: [
    { pathname: '/search', query },
    { pathname: '/search', query, when: { path: 'hasNext', equals: true }, repeat: { maxIterations: 3, until: { path: 'hasNext', equals: false }, collect: { path: 'items', identityPath: 'id', maxItems: 10, includePrevious: true }, ...repeat } },
  ] };
  let count = 0, cancelled = false;
  const chrome = { tabs: { get: async () => ({ url: route }) }, debugger: { sendCommand: async () => ({ frameTree: { frame: { id: 'main', loaderId: count === replaceAt ? 'changed' : 'completed' } } }) } };
  const values = responses || [{ items: [{ id: '007' }], hasNext: when }, { items: [{ id: '007' }, { id: '008' }], hasNext: true }, { items: [{ id: '009' }], hasNext: false }];
  return { count: () => count, source: controlled, run: () => executePageWorkflow({ chrome, tabId: 9,
    payload: { source: controlled, expectedOrigin: 'https://example.com', expectedPath: '/search', metadataOnly }, now: () => 0,
    assertRunning: () => { if (cancelled) throw Object.assign(Error('Cancelled'), { code: 'PAGE_WORKFLOW_CANCELLED' }); } }, async () => {
      const data = values[Math.min(count, values.length - 1)]; count++;
      if (count === cancelAt) cancelled = true;
      return { ok: true, data, internalWorkflowPage: page };
    }) };
}
test('conditional pagination collects initial and new rows, skips absent next and never persists observed values', async () => {
  const f = controlFixture(), output = await f.run();
  assert.equal(output.ok, true); assert.equal(f.count(), 3);
  assert.deepEqual(output.workflow, { completedSteps: 2, skippedSteps: 0, executedActions: 3, collections: [{ stepIndex: 1, iterations: 2, path: 'items', items: [{ id: '007' }, { id: '008' }, { id: '009' }] }] });
  const skipped = controlFixture({ when: false }), single = await skipped.run();
  assert.equal(skipped.count(), 1); assert.equal(single.workflow.skippedSteps, 1); assert.deepEqual(single.workflow.collections[0].items, [{ id: '007' }]);
  const observed = await controlFixture({ metadataOnly: true }).run();
  assert.equal(observed.data, undefined); assert.equal(observed.workflow.collections, undefined);
  assert.deepEqual(observed.workflow.collectedCounts, [3]); assert.ok(!JSON.stringify(observed).includes('007'));
});
test('repeat exhaustion, duplicate-only pages, identity conflicts and collection limits fail without partial output', async () => {
  const first = { items: [{ id: '007', title: 'Example' }], hasNext: true };
  const samples = [
    ['PAGE_WORKFLOW_ITERATION_LIMIT', { collect: undefined }, [first]],
    ['PAGE_WORKFLOW_NO_PROGRESS', {}, [first]],
    ['PAGE_WORKFLOW_IDENTITY_CONFLICT', {}, [first, { items: [{ id: '007', title: 'Changed' }], hasNext: false }]],
    ['PAGE_WORKFLOW_COLLECTION_LIMIT', { collect: { path: 'items', identityPath: 'id', maxItems: 1, includePrevious: true } }, [first, { items: [{ id: '008' }], hasNext: false }]],
    ['PAGE_WORKFLOW_COLLECTION_LIMIT', {}, [{ items: [{ id: '007', title: 'x'.repeat(500000) }], hasNext: true }, { items: [{ id: '008', title: 'x'.repeat(500000) }], hasNext: false }]],
    ['PAGE_WORKFLOW_CONDITION', {}, [{ items: [], hasNext: {} }]],
  ];
  for (const [code, repeat, responses] of samples) {
    const f = controlFixture({ repeat, responses }), out = await f.run();
    assert.equal(out.error.code, code); assert.equal(out.error.stepIndex, 1); assert.equal(out.error.completedSteps, 1);
    assert.equal(out.data, undefined); assert.equal(out.workflow, undefined); assert.ok(f.count() <= 4);
  }
});
test('repeated actions stop on document replacement or cancellation before the next iteration', async () => {
  for (const options of [{ replaceAt: 2 }, { cancelAt: 2 }]) {
    const f = controlFixture(options), out = await f.run();
    assert.equal(out.error.code, options.replaceAt ? 'PAGE_QUERY_ROUTE_CHANGED' : 'PAGE_WORKFLOW_CANCELLED');
    assert.equal(f.count(), 2); assert.equal(out.error.stepIndex, 1); assert.equal(out.error.iteration, 1);
  }
});
test('workflow permissions bind conditions, stop rules and collection limits while preserving extraction repair', () => {
  const f = controlFixture();
  const declared = { version: 1, source: f.source, expectedOrigin: 'https://example.com', expectedPath: '/search' };
  const command = { safety: 'read', pageWorkflow: true, pageRoute: { origin: 'https://example.com', pathname: '/search', workflow: pageWorkflowContract(f.source) } };
  assert.equal(assertPageQueryRoute(declared, command), 'https://example.com/search');
  for (const mutate of [step => step.when.equals = false, step => step.repeat.maxIterations++, step => step.repeat.collect.maxItems++, step => step.repeat.until.equals = true]) {
    const changed = structuredClone(declared); mutate(changed.source.steps[1]);
    assert.throws(() => assertPageQueryRoute(changed, command));
  }
});
