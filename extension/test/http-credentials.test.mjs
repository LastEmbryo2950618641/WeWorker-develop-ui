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

test('v2 scopes the exact store and partition, rejecting returned mismatches without fallback', async () => {
  const partitionKey = { topLevelSite: 'https://example.org', hasCrossSiteAncestor: true };
  const correct = { name: 'example_session', value: 'example-partition', storeId: '0', partitionKey };
  const calls = [];
  const chrome = { cookies: { getAll: async payload => { calls.push(payload); return [correct,
    { ...correct, value: 'wrong-store', storeId: '1' }, { ...correct, value: 'wrong-ancestor', partitionKey: { ...partitionKey, hasCrossSiteAncestor: false } },
    { ...correct, value: 'wrong-site', partitionKey: { ...partitionKey, topLevelSite: 'https://example.com' } },
    { ...correct, value: 'missing-ancestor', partitionKey: { topLevelSite: partitionKey.topLevelSite } },
    { ...correct, value: 'unpartitioned', partitionKey: undefined }]; } } };
  const payload = { version: 2, url: 'https://example.com/api/items', names: ['example_session'], storeId: '0', partitionKey };
  assert.deepEqual(await readHttpCookies(chrome, payload), { cookies: [{ name: 'example_session', value: 'example-partition' }] });
  assert.deepEqual(calls, [{ url: payload.url, storeId: '0', partitionKey }]);
  assert.deepEqual(await readHttpCookies(chrome, { ...payload, partitionKey: undefined }), { cookies: [{ name: 'example_session', value: 'unpartitioned' }] });
});

test('requires v2 for scopes and an explicit ancestor flag; never retries an unsupported browser query', async () => {
  const calls = [];
  const chrome = { cookies: { getAll: async payload => { calls.push(payload); throw new Error('unsupported'); } } };
  const payload = { version: 2, url: 'https://example.com/api/items', names: ['example_session'], storeId: '0', partitionKey: { topLevelSite: 'https://example.org', hasCrossSiteAncestor: true } };
  for (const change of [p => { p.version = 1; }, p => { p.version = 3; }, p => { p.storeId = ''; },
    p => { delete p.partitionKey.hasCrossSiteAncestor; }, p => { p.partitionKey.topLevelSite += '/path'; }, p => { p.partitionKey.extra = true; }, p => { p.unexpected = true; }]) {
    const invalid = structuredClone(payload); change(invalid);
    await assert.rejects(readHttpCookies(chrome, invalid), /Invalid scoped/);
  }
  assert.equal(calls.length, 0);
  await assert.rejects(readHttpCookies(chrome, payload), /unsupported/);
  assert.equal(calls.length, 1);
});
