import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { ExplorationService } from '../exploration-service.js';
import { extractExplorationEvidence } from '../exploration-evidence.js';
import { resolveAdapterPaths } from '../paths.js';
import { buildAdapterCatalog } from '../adapter-catalog.js';

const roots = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const capture = { network: { entries: [
  { url: 'https://example.com/api/list?page=2&token=placeholder-secret', method: 'GET', status: 200, responseContentType: 'application/json',
    responsePreview: JSON.stringify({ data: { items: [{ id: 'placeholder-id', name: 'placeholder-person' }] } }) },
  { url: 'https://example.com/api/delete', method: 'GET', status: 200 },
  { url: 'https://example.org/api/list', method: 'GET', status: 200 },
] } };
function setup(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exploration-')); roots.push(root);
  for (const [key, value] of Object.entries({ WEWORKER_USER_ADAPTERS_DIR: path.join(root, 'user'), WEBCLI_ADAPTERS_DIR: path.join(root, 'user'), WEWORKER_ADAPTER_DATA_DIR: path.join(root, 'data'), WEWORKER_BUILTIN_ADAPTERS_DIR: path.join(root, 'builtin'), WEWORKER_BUILD_PROFILE: 'public' })) vi.stubEnv(key, value);
  const paths = resolveAdapterPaths();
  const requestExtension = vi.fn(async message => message.type === 'exploration_list_tabs' ? { tabs: [{ id: 7, url: 'https://example.com/list?token=placeholder-secret', title: 'placeholder-person' }] } : capture);
  const runtimeValidator = vi.fn(async () => ({ passed: true, executionSummary: { attempted: 1, passed: 1, failed: 0, skipped: 0 } }));
  const options = { rootDir: path.join(root, 'tasks'), paths, requestExtension, runtimeValidator,
    capabilities: () => ({ connected: true, capabilities: ['passive_exploration_v1'] }), ...extra };
  return { root, paths, requestExtension, runtimeValidator, options, service: new ExplorationService(options) };
}
async function start(service, requestId = 'example-request') {
  const result = await service.execute('start', { tabId: '7', goal: 'Explore list queries', requestId });
  expect(result.ok).toBe(true);
  await service.jobs.get(result.data.taskId);
  return result.data.taskId;
}
async function draft(service) {
  const taskId = await start(service);
  const result = await service.execute('generate', { taskId });
  expect(result).toMatchObject({ ok: true, data: { status: 'draft' } });
  return taskId;
}

it('returns only structural evidence and rejects mutation/cross-origin candidates for generation', async () => {
  const f = setup(); const taskId = await start(f.service);
  const evidence = await f.service.execute('evidence', { taskId });
  expect(evidence.data.candidates).toHaveLength(2);
  expect(JSON.stringify(evidence)).not.toMatch(/placeholder-secret|placeholder-person|placeholder-id/);
  expect(evidence.data.candidates[0].responseHints.listPath).toBe('data.items');
  expect(evidence.data.candidates[1].risk.level).toBe('write');
  expect(fs.readFileSync(path.join(f.options.rootDir, `${taskId}.json`), 'utf8')).not.toMatch(/placeholder-secret|placeholder-person|placeholder-id/);
  const bad = await f.service.execute('generate', { taskId, plan: { tools: [{ name: 'delete_items', risk: 'read', sourceApiKind: 'list', sourceApiIndexes: [1] }] } });
  expect(bad).toMatchObject({ ok: false, error: { code: 'INVALID_PLAN' } });
});

it('deduplicates concurrent starts and persists identity across a new service process', async () => {
  const f = setup();
  const args = { tabId: '7', goal: 'Explore', requestId: 'same' };
  const [a, b] = await Promise.all([f.service.execute('start', args), f.service.execute('start', args)]);
  expect(a.data.taskId).toBe(b.data.taskId);
  await f.service.jobs.get(a.data.taskId);
  const restored = new ExplorationService(f.options);
  expect((await restored.execute('start', args)).data.taskId).toBe(a.data.taskId);
  expect((await restored.execute('start', { ...args, goal: 'Different' })).error.code).toBe('REQUEST_CONFLICT');
  expect(f.requestExtension.mock.calls.filter(([msg]) => msg.type === 'exploration_capture_passive')).toHaveLength(1);
});

it('cancellation wins over late capture and restart never replays browser actions', async () => {
  let finish;
  const f = setup();
  const original = f.requestExtension.getMockImplementation();
  f.requestExtension.mockImplementation(message => message.type === 'exploration_capture_passive' ? new Promise(resolve => { finish = resolve; }) : original(message));
  const response = await f.service.execute('start', { tabId: 7, goal: 'Explore', requestId: 'cancel' });
  const taskId = response.data.taskId;
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  const restored = new ExplorationService(f.options);
  expect((await restored.execute('get', { taskId })).data.status).toBe('interrupted');
  await f.service.execute('cancel', { taskId }); finish(capture); await f.service.jobs.get(taskId);
  expect((await f.service.execute('get', { taskId })).data).toMatchObject({ status: 'cancelled', candidateCount: 0 });
});

it('does not accept evidence if tab origin changes while capture is in flight', async () => {
  const f = setup(); let tabs = 0;
  f.requestExtension.mockImplementation(async message => message.type === 'exploration_list_tabs'
    ? { tabs: [{ id: 7, url: ++tabs > 2 ? 'https://example.org/' : 'https://example.com/' }] } : capture);
  const taskId = await start(f.service);
  expect((await f.service.execute('get', { taskId })).data).toMatchObject({ status: 'failed', error: { code: 'TAB_CHANGED' } });
});

it('rejects invalid params and traversal; repairs invalid draft JSON with hash guarded writes', async () => {
  const { service } = setup();
  expect((await service.execute('start', { tabId: '1.5', goal: 'x', requestId: 'x' })).error.code).toBe('INVALID_ARGUMENT');
  expect((await service.execute('tabs', { url: 'https://example.com' })).error.code).toBe('INVALID_ARGUMENT');
  const taskId = await draft(service);
  expect((await service.execute('draft-read', { taskId, file: '../outside' })).error.code).toBe('INVALID_ARGUMENT');
  const before = (await service.execute('draft-read', { taskId, file: 'manifest.json' })).data;
  expect((await service.execute('draft-write', { taskId, file: 'manifest.json', expectedHash: 'old', content: '{}' })).error.code).toBe('STALE_DRAFT');
  expect((await service.execute('draft-write', { taskId, file: 'manifest.json', expectedHash: before.hash, content: '{' })).ok).toBe(true);
  const broken = (await service.execute('draft-read', { taskId, file: 'manifest.json' })).data;
  expect((await service.execute('draft-write', { taskId, file: 'manifest.json', expectedHash: broken.hash, content: before.content })).ok).toBe(true);
});

it('generates, verifies, reviews and installs using existing package machinery without a model', async () => {
  const f = setup(); const taskId = await draft(f.service);
  expect(buildAdapterCatalog({ paths: f.paths }).effective).toHaveLength(0);
  expect((await f.service.execute('review', { taskId })).error.code).toBe('VALIDATION_REQUIRED');
  expect((await f.service.execute('validate', { taskId })).ok).toBe(true);
  await f.service.jobs.get(taskId);
  expect((await f.service.execute('get', { taskId })).data.status).toBe('review_ready');
  const reviewed = await f.service.execute('review', { taskId });
  expect(reviewed.ok).toBe(true);
  expect((await f.service.execute('install', { taskId, reviewId: reviewed.data.reviewId })).error.code).toBe('CONFIRMATION_REQUIRED');
  expect((await f.service.execute('install', { taskId, reviewId: 'stale', confirmed: true })).error.code).toBe('STALE_REVIEW');
  expect((await f.service.execute('install', { taskId, reviewId: reviewed.data.reviewId, confirmed: 'true' })).ok).toBe(true);
  await f.service.jobs.get(taskId);
  expect((await f.service.execute('get', { taskId })).data.status).toBe('installed');
  expect(buildAdapterCatalog({ paths: f.paths }).effective[0].name).toBe('example.com');
});

it('does not permit skipped runtime validation or editing after validation to install', async () => {
  const f = setup({ runtimeValidator: async () => ({ passed: true, executionSummary: { attempted: 0, passed: 0, skipped: 1, failed: 0 } }) });
  const taskId = await draft(f.service);
  await f.service.execute('validate', { taskId }); await f.service.jobs.get(taskId);
  expect((await f.service.execute('review', { taskId })).error.code).toBe('VALIDATION_REQUIRED');
  const good = setup(); const goodId = await draft(good.service);
  await good.service.execute('validate', { taskId: goodId }); await good.service.jobs.get(goodId);
  const file = (await good.service.execute('draft-read', { taskId: goodId, file: 'manifest.json' })).data;
  await good.service.execute('draft-write', { taskId: goodId, file: 'manifest.json', content: file.content + '\n', expectedHash: file.hash });
  expect((await good.service.execute('review', { taskId: goodId })).error.code).toBe('VALIDATION_REQUIRED');
});

it('does not trust scalar values embedded in supplied evidence shapes', () => {
  const evidence = extractExplorationEvidence({ entries: [{ url: 'https://example.com/api/list', responseEvidence: { bodyKind: 'json', bodyShape: { type: 'object', properties: { name: { type: 'string', example: 'placeholder-secret' } } } } }] }, 'https://example.com');
  expect(JSON.stringify(evidence)).not.toContain('placeholder-secret');
});

it('bounds safe probes to inspected read actions and persists only their network structures', async () => {
  const f = setup({ capabilities: () => ({ connected: true, capabilities: ['passive_exploration_v1', 'safe_api_probe_v1'] }) });
  const original = f.requestExtension.getMockImplementation();
  f.requestExtension.mockImplementation(message => {
    if (message.type === 'exploration_safe_actions_inspect') return { candidates: [{ id: 'safe-1', kind: 'search', risk: 'read', requiresValue: true, label: 'placeholder-person' }, { id: 'unsafe', kind: 'delete', risk: 'write' }] };
    if (message.type === 'exploration_safe_probe_run') return { networkDelta: { entries: [{ ...capture.network.entries[0], url: 'https://example.com/api/search?q=private-query' }] } };
    return original(message);
  });
  const taskId = await start(f.service);
  expect((await f.service.execute('probe', { taskId, candidateId: 'safe-1', value: 'test' })).error.code).toBe('STALE_ACTION');
  for (let i = 0; i < 3; i++) {
    const actions = await f.service.execute('actions', { taskId });
    expect(actions.data.candidates).toHaveLength(1);
    expect(JSON.stringify(actions)).not.toContain('placeholder-person');
    expect((await f.service.execute('probe', { taskId, candidateId: 'safe-1' })).error.code).toBe('INVALID_ARGUMENT');
    expect((await f.service.execute('probe', { taskId, candidateId: 'safe-1', value: 'test' })).ok).toBe(true);
    await f.service.jobs.get(taskId);
  }
  expect((await f.service.execute('probe', { taskId, candidateId: 'safe-1', value: 'test' })).error.code).toBe('PROBE_LIMIT');
  expect(JSON.stringify((await f.service.execute('evidence', { taskId })).data)).not.toContain('private-query');
});

it('runs the actual preview validator and generated JavaScript before standalone installation', async () => {
  const f = setup({ runtimeValidator: undefined });
  const original = f.requestExtension.getMockImplementation();
  const requests = [];
  f.requestExtension.mockImplementation(async message => {
    if (message.type === 'exploration_capture_passive') return { entries: [{ url: 'https://example.com/api/list', method: 'GET', status: 200, responsePreview: '{"data":[{"id":"fixture-id"}]}' }] };
    if (message.type !== 'validate_generation_preview') return original(message);
    const tools = [];
    const context = vm.createContext({ URL, URLSearchParams, location: { origin: 'https://example.com' },
      __webmcpRegister: adapter => tools.push(...adapter.tools),
      fetch: async url => { requests.push(String(url)); return { ok: true, status: 200, text: async () => '{"data":[{"id":"fixture-id"}]}' }; } });
    vm.runInContext('var window = globalThis', context);
    for (const script of message.previewBundle.scripts) vm.runInContext(script.source, context);
    if (!message.testCases) return { passed: true, tools: tools.map(({ handler, ...tool }) => tool) };
    // The real extension reports login utilities as skipped. Only requested
    // generated tools belong in this workflow's strict all-executed gate.
    expect(message.testCases).toHaveLength(1);
    expect(message.testCases[0].toolName).not.toMatch(/check[-_]login/);
    const executable = message.testCases.filter(test => test.execute);
    expect(executable).toHaveLength(1);
    for (const test of executable) {
      const tool = tools.find(tool => tool.name === test.toolName);
      const output = await tool.handler(test.args || {});
      expect(output.ok).toBe(true);
    }
    return { passed: true, executionSummary: { attempted: executable.length, passed: executable.length, failed: 0, skipped: message.testCases.length - executable.length } };
  });
  const taskId = await draft(f.service);
  await f.service.execute('validate', { taskId }); await f.service.jobs.get(taskId);
  expect((await f.service.execute('get', { taskId })).data.status).toBe('review_ready');
  expect(requests).toEqual(['https://example.com/api/list']);
  const review = (await f.service.execute('review', { taskId })).data;
  await f.service.execute('install', { taskId, reviewId: review.reviewId, confirmed: true }); await f.service.jobs.get(taskId);
  expect((await f.service.execute('get', { taskId })).data.status).toBe('installed');
});

it('grants only explicit API origins and binds grants to the idempotency key and draft permissions', async () => {
  const f = setup();
  const args = { tabId: 7, goal: 'Explore API', requestId: 'origins', allowedOrigins: ['https://example.org'] };
  for (const allowedOrigins of ['https://example.org', ['https://example.org/path'], ['https://user:placeholder@example.org'], ['file:///example'], ['https://example.org/']]) {
    expect((await f.service.execute('start', { ...args, allowedOrigins })).error.code).toBe('INVALID_ARGUMENT');
  }
  const started = await f.service.execute('start', args); expect(started.ok).toBe(true);
  const taskId = started.data.taskId; await f.service.jobs.get(taskId);
  expect((await f.service.execute('start', { ...args, allowedOrigins: ['https://example.org', 'https://example.org'] })).data.taskId).toBe(taskId);
  expect((await f.service.execute('start', { ...args, allowedOrigins: [] })).error.code).toBe('REQUEST_CONFLICT');
  const evidence = (await f.service.execute('evidence', { taskId })).data;
  const index = evidence.candidates.findIndex(item => new URL(item.url).origin === 'https://example.org');
  expect(index).toBeGreaterThanOrEqual(0);
  expect((await f.service.execute('generate', { taskId, plan: { tools: [{ name: 'query_items', risk: 'read', sourceApiKind: 'list', sourceApiIndexes: [index] }] } })).ok).toBe(true);
  const manifest = JSON.parse((await f.service.execute('draft-read', { taskId, file: 'manifest.json' })).data.content);
  expect(manifest.runtime_allowed_hosts).toContain('example.org');
  expect(extractExplorationEvidence({ entries: [{ url: 'https://example.net/api/list' }] }, 'https://example.com', ['https://example.org'])).toEqual([]);
});

it('shares tab leases with browser commands and holds cancellation leases until the browser request settles', async () => {
  const { BrowserService } = await import('../browser-service.js');
  const { TabOperationLocks } = await import('../tab-operation-locks.js');
  const tabLocks = new TabOperationLocks(); const f = setup({ tabLocks });
  const browser = new BrowserService({ rootDir: path.join(f.root, 'browser'), tabLocks,
    capabilities: () => ({ connected: true, capabilities: ['browser_commands_v1'] }),
    requestExtension: async message => message.type === 'exploration_list_tabs' ? { tabs: [{ id: 7, url: 'https://example.com' }] } : { ok: true, data: { identity: 'example-identity' } } });
  await browser.execute('bind', { session: 'work', tabId: 7 });
  let finish; const original = f.requestExtension.getMockImplementation();
  f.requestExtension.mockImplementation(message => message.type === 'exploration_capture_passive' ? new Promise(resolve => { finish = resolve; }) : original(message));
  const taskId = (await f.service.execute('start', { tabId: 7, goal: 'Explore', requestId: 'shared' })).data.taskId;
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect((await browser.execute('click', { session: 'work', selector: '#next' })).error.code).toBe('TAB_BUSY');
  await f.service.execute('cancel', { taskId });
  expect((await browser.execute('state', { session: 'work' })).error.code).toBe('TAB_BUSY');
  finish(capture); await f.service.jobs.get(taskId);
  expect((await browser.execute('state', { session: 'work' })).ok).toBe(true);
  const release = tabLocks.acquire(7);
  const blocked = await f.service.execute('start', { tabId: 7, goal: 'Explore', requestId: 'blocked' });
  expect(blocked.error.code).toBe('TAB_BUSY'); release();
  const retry = await f.service.execute('start', { tabId: 7, goal: 'Explore', requestId: 'blocked' });
  expect(retry.data.status).toBe('collecting');
  await vi.waitFor(() => expect(f.requestExtension.mock.calls.filter(([msg]) => msg.type === 'exploration_capture_passive')).toHaveLength(2));
  finish(capture); await f.service.jobs.get(retry.data.taskId);
});

it('generates more than two authored queries with JSON/form POST and rejects mutation or unresolved GraphQL', async () => {
  const f = setup(); const original = f.requestExtension.getMockImplementation();
  f.requestExtension.mockImplementation(message => message.type === 'exploration_capture_passive' ? { entries: [
    { url: 'https://example.com/api/search', method: 'POST', status: 200, requestBody: '{"keyword":"placeholder-private"}' },
    { url: 'https://example.com/api/query', method: 'POST', status: 200, requestBody: 'keyword=placeholder-private' },
    { url: 'https://example.com/graphql', method: 'POST', status: 200, requestBody: '{"query":"query List { items { id } }","variables":{"keyword":"placeholder-private"}}' },
    { url: 'https://example.com/graphql?operation=mutation', method: 'POST', status: 200, requestBody: '{"query":"mutation Delete { deleteItem(id: 1) }"}' },
    { url: 'https://example.com/query', method: 'POST', status: 200, requestBody: '{"op":"delete"}' },
    { url: 'https://example.com/graphql/persisted', method: 'POST', status: 200, requestBody: '{"extensions":{"persistedQuery":{"sha256Hash":"placeholder-hash"}}}' },
  ] } : original(message));
  const taskId = await start(f.service);
  const evidence = (await f.service.execute('evidence', { taskId })).data.candidates;
  expect(evidence.map(item => item.risk.level)).toEqual(['read', 'read', 'read', 'write', 'write', 'unknown']);
  expect(JSON.stringify(evidence)).not.toMatch(/placeholder-private|query List|Delete|placeholder-hash/);
  const tools = [0, 1, 2].map(i => ({ name: `query_${i}`, risk: 'read', sourceApiKind: 'list', sourceApiIndexes: [i], readReason: 'Observed lookup response; no mutation operation.' }));
  expect((await f.service.execute('generate', { taskId, plan: { tools: [{ ...tools[0], readReason: undefined }] } })).error.code).toBe('INVALID_PLAN');
  for (const index of [3, 4, 5]) expect((await f.service.execute('generate', { taskId, plan: { tools: [{ ...tools[0], sourceApiIndexes: [index] }] } })).error.code).toBe('INVALID_PLAN');
  const generated = await f.service.execute('generate', { taskId, plan: { tools } }); expect(generated.ok).toBe(true);
  expect(generated.data.toolNames).toHaveLength(3);
  const commands = [];
  for (let i = 0; i < 3; i++) commands.push((await f.service.execute('draft-read', { taskId, file: `extension/commands/query-${i}.js` })).data.content);
  expect(commands[0]).toContain('sendJson('); expect(commands[1]).toContain('postForm('); expect(commands[2]).toContain('sendJson(');
  await f.service.execute('validate', { taskId }); await f.service.jobs.get(taskId);
  expect((await f.service.execute('get', { taskId })).data.validation.passed).toBe(true);
});

it('adds authored helpers without overwriting files, invalidates approval and exports a structural trace', async () => {
  const f = setup(); const taskId = await draft(f.service);
  await f.service.execute('validate', { taskId }); await f.service.jobs.get(taskId);
  expect((await f.service.execute('draft-add', { taskId, file: '../escape.js', content: '' })).error.code).toBe('INVALID_ARGUMENT');
  const helper = { taskId, file: 'extension/internal/example-helper.js', content: 'window.exampleHelper = value => value;' };
  expect((await f.service.execute('draft-add', helper)).ok).toBe(true);
  expect((await f.service.execute('draft-add', helper)).error.code).toBe('FILE_EXISTS');
  expect((await f.service.execute('review', { taskId })).error.code).toBe('VALIDATION_REQUIRED');
  await f.service.execute('validate', { taskId }); await f.service.jobs.get(taskId);
  expect((await f.service.execute('get', { taskId })).data.status).toBe('review_ready');
  const trace = (await f.service.execute('trace', { taskId })).data;
  expect(trace.files).toContain(helper.file); expect(trace.structuralOnly).toBe(true);
  expect(JSON.stringify(trace)).not.toMatch(/window.exampleHelper|placeholder-secret|placeholder-person/);
});
