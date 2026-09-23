import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { injectAdapterSources } from '../background/adapter-script-loader.js';

function harness({ attached = false, failScript = false, navigate = false } = {}) {
  const listeners = new Set();
  const context = vm.createContext({});
  const calls = [];
  let tabReads = 0;
  const api = {
    tabs: { get: async () => ({ url: navigate && ++tabReads > 1 ? 'https://other.example.com/' : 'https://example.com/' }) },
    scripting: { executeScript: async ({ func, args, ...rest }) => {
      calls.push(['scripting', rest]);
      vm.runInContext('(' + func.toString() + ')(' + JSON.stringify(args[0]) + ')', context);
      return [{ frameId: 0, documentId: 'fixture-document' }];
    } },
    debugger: {
      onEvent: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
      attach: async () => { calls.push(['attach']); if (attached) throw new Error('Another debugger is already attached'); attached = true; },
      detach: async () => { calls.push(['detach']); attached = false; },
      sendCommand: async (target, method, params) => {
        calls.push([method, params]);
        if (method === 'Runtime.enable') {
          for (const fn of listeners) fn(target, 'Runtime.executionContextCreated', { context: { id: 7 } });
          return {};
        }
        assert.equal(params.allowUnsafeEvalBlockedByCSP, false);
        if (failScript && params.expression.includes('sourceURL')) return { exceptionDetails: { text: 'private fixture details' } };
        return { result: { value: vm.runInContext(params.expression, context) } };
      },
    },
  };
  return { api, calls, context, listeners };
}
const script = { path: 'extension/commands/list.js', source: 'globalThis.fixtureCalls = (globalThis.fixtureCalls || 0) + 1;' };

test('loads ordered scripts in isolated world and releases only its own debugger', async () => {
  const h = harness();
  const result = await injectAdapterSources({ tabId: 1, api: h.api, scripts: [script, script] });
  assert.equal(h.context.fixtureCalls, 2);
  assert.equal(result.documentId, 'fixture-document');
  assert.equal(h.calls.filter(([name]) => name === 'detach').length, 1);
  assert.equal(h.listeners.size, 0);
  assert.deepEqual(Object.keys(h.context), ['fixtureCalls']);
});

test('never adopts or detaches another debugger', async () => {
  const h = harness({ attached: true });
  await assert.rejects(injectAdapterSources({ tabId: 2, api: h.api, scripts: [script] }), /Another debugger/);
  assert.equal(h.calls.some(([name]) => name === 'detach' || name === 'Runtime.evaluate'), false);
  assert.equal(h.listeners.size, 0);
});

test('borrows a known session without attaching or detaching', async () => {
  const h = harness({ attached: true });
  await injectAdapterSources({ tabId: 3, api: h.api, borrowedSession: true, scripts: [script] });
  assert.equal(h.calls.some(([name]) => name === 'attach' || name === 'detach'), false);
  assert.equal(h.context.fixtureCalls, 1);
});

test('navigation prevents script execution and still releases resources', async () => {
  const h = harness({ navigate: true });
  await assert.rejects(injectAdapterSources({ tabId: 4, api: h.api, scripts: [script] }), /target changed/);
  assert.equal(h.context.fixtureCalls, undefined);
  assert.equal(h.calls.at(-1)[0], 'detach');
  assert.equal(h.listeners.size, 0);
});

test('script failure hides source errors and cleans the world marker', async () => {
  const h = harness({ failScript: true });
  await assert.rejects(injectAdapterSources({ tabId: 5, api: h.api, scripts: [script] }), {
    message: 'Adapter script failed: extension/commands/list.js',
  });
  assert.deepEqual(Object.keys(h.context), []);
  assert.equal(h.calls.at(-1)[0], 'detach');
});

test('rejects unsupported targets and malformed bundles before attaching', async () => {
  const h = harness();
  await assert.rejects(injectAdapterSources({ tabId: 6, api: h.api, expectedUrl: 'https://other.example.com/', scripts: [script] }), /target changed/);
  await assert.rejects(injectAdapterSources({ tabId: 6, api: h.api, scripts: [{ ...script, path: '../outside.js' }] }), /Invalid/);
  assert.equal(h.calls.length, 0);
});
