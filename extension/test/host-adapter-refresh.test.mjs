import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostAdapterRuntime } from '../background/host-adapter-runtime.js';

test('refresh waits for a running command and later calls wait for refresh without replay', async () => {
  const order = []; let finishCall, finishRefresh;
  const runtime = createHostAdapterRuntime({ bundle: async () => [], prepare: async () => {}, clear: async () => {}, inject: async () => {} });
  const manifest = { name: 'example.com', _hostSnapshot: { digest: 'example-digest' } };
  const first = runtime.execute(7, manifest, 'https://example.com', async () => { order.push('call-start'); await new Promise(resolve => finishCall = resolve); order.push('call-end'); });
  while (!finishCall) await new Promise(resolve => setImmediate(resolve));
  const refresh = runtime.exclusive(7, async () => { order.push('refresh-start'); await new Promise(resolve => finishRefresh = resolve); runtime.invalidate(7); order.push('refresh-end'); });
  const next = runtime.execute(7, manifest, 'https://example.com', async () => order.push('next-call'));
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(order, ['call-start']);
  finishCall(); await first;
  while (!finishRefresh) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['call-start', 'call-end', 'refresh-start']);
  finishRefresh(); await refresh; await next;
  assert.deepEqual(order, ['call-start', 'call-end', 'refresh-start', 'refresh-end', 'next-call']);
});
test('failed refresh releases its queue and does not block another tab', async () => {
  const runtime = createHostAdapterRuntime({}); let reject;
  const blocked = runtime.exclusive(7, () => new Promise((resolve, fail) => reject = fail));
  await runtime.exclusive(8, async () => {});
  const next = runtime.exclusive(7, async () => 'resumed');
  reject(new Error('Example refresh failure'));
  await assert.rejects(blocked, /Example refresh failure/); assert.equal(await next, 'resumed');
});
