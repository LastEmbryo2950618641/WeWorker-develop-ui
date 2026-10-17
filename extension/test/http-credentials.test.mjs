import test from 'node:test';
import assert from 'node:assert/strict';
import { readHttpCookies } from '../background/http-credentials.js';

test('requests cookies only for the exact URL and declared names, excluding unknown partitions', async () => {
  const calls = [];
  const chrome = { cookies: { getAll: async args => { calls.push(args); return [
    { name: 'example_session', value: 'example-placeholder', httpOnly: true },
    { name: 'example_other', value: 'example-unrequested' },
    { name: 'example_session', value: 'example-partitioned', partitionKey: { topLevelSite: 'https://example.org' } },
  ]; } } };
  assert.deepEqual(await readHttpCookies(chrome, { url: 'https://example.com/api/items', names: ['example_session'] }),
    { cookies: [{ name: 'example_session', value: 'example-placeholder' }] });
  assert.deepEqual(calls, [{ url: 'https://example.com/api/items' }]);
});

test('rejects malformed requests before reading any credential store', async () => {
  const chrome = { cookies: { getAll: () => { throw new Error('should not read'); } } };
  for (const payload of [{ url: 'file:///example', names: ['example'] }, { url: 'https://example.com', names: [] },
    { url: 'https://example.com', names: ['example', 'example'] }, { url: 'https://example.com', names: ['a;b'] }]) {
    await assert.rejects(readHttpCookies(chrome, payload), /Invalid scoped/);
  }
});
