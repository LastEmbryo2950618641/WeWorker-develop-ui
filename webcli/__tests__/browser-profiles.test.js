import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { BrowserProfiles } from '../browser-profiles.js';
import { extractRuntimeFlags, resolveCliInvocation } from '../index.js';
import { followBrowser } from '../browser-follow.js';

const roots = [];
const root = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-profiles-test-')); roots.push(dir); return dir; };
afterEach(() => { vi.unstubAllEnvs(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const socket = () => ({ readyState: 1 });
it('persists aliases/defaults, lists offline contexts and never falls back from an explicit offline choice', () => {
  const dir = root(), profiles = new BrowserProfiles(dir), a = randomUUID(), b = randomUUID();
  const first = socket(), second = socket(); profiles.register(first, { contextId: a });
  expect(profiles.select().contextId).toBe(a);
  profiles.register(second, { contextId: b });
  expect(() => profiles.select()).toThrow(expect.objectContaining({ code: 'PROFILE_AMBIGUOUS' }));
  profiles.execute('rename', { contextId: a, name: 'work' }); profiles.execute('rename', { contextId: b, name: 'personal' });
  profiles.execute('use', { name: 'work' }); expect(profiles.select().contextId).toBe(a);
  expect(profiles.select('personal').contextId).toBe(b);
  profiles.disconnect(first);
  expect(() => profiles.select()).toThrow(expect.objectContaining({ code: 'PROFILE_OFFLINE' }));
  expect(profiles.select('work', { allowOffline: true })).toMatchObject({ contextId: a, connection: null });
  const restored = new BrowserProfiles(dir);
  expect(restored.execute('list').profiles).toContainEqual(expect.objectContaining({ contextId: a, alias: 'work', online: false }));
  expect(restored.state.defaultContextId).toBe(a);
  profiles.execute('use', { name: 'auto' }); expect(profiles.select().contextId).toBe(b);
});
it('rejects duplicate live identities, alias collisions, path input and invalid configuration without overwriting', () => {
  const dir = root(), profiles = new BrowserProfiles(dir), id = randomUUID(); const ws = socket();
  const original = profiles.register(ws, { contextId: id });
  expect(profiles.register(ws, { contextId: id })).toBe(original);
  expect(() => profiles.register(socket(), { contextId: id })).toThrow(expect.objectContaining({ code: 'PROFILE_ID_CONFLICT' }));
  expect(() => profiles.register(ws, { contextId: randomUUID() })).toThrow(expect.objectContaining({ code: 'PROFILE_ID_CHANGED' }));
  expect(() => profiles.register(socket(), { contextId: '../../example' })).toThrow(expect.objectContaining({ code: 'PROFILE_ID_INVALID' }));
  const other = randomUUID(); profiles.register(socket(), { contextId: other }); profiles.execute('rename', { contextId: id, name: 'work' });
  expect(() => profiles.execute('rename', { contextId: other, name: 'work' })).toThrow(expect.objectContaining({ code: 'PROFILE_ALIAS_CONFLICT' }));
  for (const name of ['legacy', '../example', '', '__proto__', 'a1111111-1111-4111-8111-111111111111']) expect(() => profiles.execute('rename', { contextId: id, name })).toThrow();
  expect(() => profiles.select('missing')).toThrow(expect.objectContaining({ code: 'PROFILE_NOT_FOUND' }));
  fs.writeFileSync(profiles.file, '{invalid'); expect(() => new BrowserProfiles(dir)).toThrow(expect.objectContaining({ code: 'PROFILE_STORE_INVALID' }));
  expect(fs.readFileSync(profiles.file, 'utf8')).toBe('{invalid');
});
it('does not reassign an old operation to a reconnected socket, and isolates legacy sockets', () => {
  const profiles = new BrowserProfiles(root()), id = randomUUID(), old = socket(); profiles.register(old, { contextId: id });
  const route = profiles.select(); profiles.disconnect(old); profiles.register(socket(), { contextId: id });
  expect(() => profiles.assertConnection(route)).toThrow(expect.objectContaining({ code: 'PROFILE_DISCONNECTED' }));
  profiles.disconnect(profiles.connections.get(id).ws);
  const legacy = socket(); profiles.register(legacy, {}); const firstLegacy = profiles.select();
  expect(firstLegacy.connection.legacy).toBe(true); profiles.disconnect(legacy); profiles.register(socket(), {});
  expect(profiles.select().contextId).not.toBe(firstLegacy.contextId);
  expect(profiles.select('legacy')).toMatchObject({ readOnly: true, connection: null });
});
it('takes flag over environment and keeps routing options outside business arguments', () => {
  vi.stubEnv('WEBCLI_PROFILE', 'personal');
  for (const argv of [['--profile', 'work', 'call', 'example.com.read', '--keyword=hello'], ['call', 'example.com.read', '--profile=work', '--keyword=hello']]) {
    const parsed = extractRuntimeFlags(argv); expect(parsed.profile).toBe('work');
    expect(resolveCliInvocation(parsed.args).flagArgs).toEqual({ keyword: 'hello' });
  }
  expect(extractRuntimeFlags(['call', 'browser.tabs']).profile).toBe('personal');
  expect(() => extractRuntimeFlags(['--profile'])).toThrow('--profile requires');
});
it('pins follow polls to the first context and connection, even after defaults change', async () => {
  const calls = [], controller = new AbortController();
  const request = async (args, opts) => {
    calls.push(opts);
    if (calls.length === 2) controller.abort('SIGINT');
    return { ok: true, contextId: 'example-context', connectionId: 'example-socket', data: { observationVersion: 1, entries: [], startCursor: 'start', nextCursor: 'next' } };
  };
  const code = await followBrowser('console', { session: 'work' }, { request, emit: async () => {}, sleep: async () => {}, signal: controller.signal });
  expect(code).toBe(130); expect(calls[1]).toMatchObject({ profile: 'example-context', connectionId: 'example-socket' });
});
