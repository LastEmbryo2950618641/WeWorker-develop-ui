import assert from 'node:assert/strict';
import { test } from 'node:test';

test('browser identity is generated once, stored before use, and survives module reload', async () => {
  const values = {}; let writes = 0, creates = 0;
  const storage = { get: async key => ({ [key]: values[key] }), set: async update => { writes++; Object.assign(values, update); } };
  const uuid = () => { creates++; return '11111111-1111-4111-8111-111111111111'; };
  const first = await import('../background/browser-profile.js?first');
  const identities = await Promise.all([first.browserContextId(storage, uuid), first.browserContextId(storage, uuid)]);
  assert.equal(identities[0], identities[1]); assert.equal(writes, 1); assert.equal(creates, 1);
  const restored = await import('../background/browser-profile.js?restored');
  assert.equal(await restored.browserContextId(storage, uuid), identities[0]); assert.equal(creates, 1);
});
test('invalid stored identities and failed writes never produce a hello identity', async () => {
  const module = await import('../background/browser-profile.js?invalid');
  await assert.rejects(module.browserContextId({ get: async () => ({ webcliBrowserContextId: '../example' }) }), /Invalid browser/);
  await assert.rejects(module.browserContextId({ get: async () => ({}), set: async () => { throw new Error('example storage unavailable'); } }, () => '11111111-1111-4111-8111-111111111111'), /storage unavailable/);
});
