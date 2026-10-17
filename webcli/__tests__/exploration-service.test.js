import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { ExplorationService } from '../exploration-service.js';
import { extractExplorationEvidence } from '../exploration-evidence.js';
import { resolveAdapterPaths } from '../paths.js';
import { buildAdapterCatalog } from '../adapter-catalog.js';
import { readPackageDirectory } from '../adapter-package-files.js';
import { verifyRetainedPackage } from '../generation-harness/existing-site.js';
import { readGenerationEvidence } from '../generation-harness/package-inspection.js';

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
    capabilities: () => ({ connected: true, capabilities: ['passive_exploration_v1', 'strict_output_contract_v1'] }), ...extra };
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

it('persists hash-bound authored verification cases and invalidates previous approval', async () => {
  const f = setup(); const taskId = await draft(f.service);
  const tool = (await f.service.execute('get', { taskId })).data.toolNames[0];
  const before = (await f.service.execute('verification-read', { taskId, tool })).data;
  const cases = [{ id: 'example-page', args: { page: 2 }, expect: { rowCount: { path: 'data.items', min: 1 } } }];
  expect((await f.service.execute('verification-write', { taskId, tool, expectedHash: 'stale', cases })).error.code).toBe('STALE_VERIFICATION');
  expect((await f.service.execute('verification-write', { taskId, tool, expectedHash: before.hash, cases })).ok).toBe(true);
  await f.service.execute('validate', { taskId }); await f.service.jobs.get(taskId);
  expect(f.runtimeValidator.mock.calls[0][0].verification[tool][0].args).toEqual({ page: 2 });
  const restored = new ExplorationService(f.options);
  const current = (await restored.execute('verification-read', { taskId, tool })).data;
  expect(current.cases[0].id).toBe('example-page');
  const oldExtension = new ExplorationService({ ...f.options, capabilities: () => ({ connected: true, capabilities: ['passive_exploration_v1'] }) });
  expect((await oldExtension.execute('validate', { taskId })).error.code).toBe('CAPABILITY_UNAVAILABLE');
  expect((await oldExtension.execute('verification-write', { taskId, tool, expectedHash: current.hash, cases })).error.code).toBe('CAPABILITY_UNAVAILABLE');
  await restored.execute('verification-write', { taskId, tool, expectedHash: current.hash, cases });
  expect((await restored.execute('review', { taskId })).error.code).toBe('VALIDATION_REQUIRED');
});

it('promotes only validated structural evidence and authored cases into site knowledge', async () => {
  const f = setup(); const taskId = await draft(f.service);
  const known = (await f.service.execute('knowledge-read', { site: 'example.com' })).data;
  expect((await f.service.execute('knowledge-save', { taskId, expectedHash: known.hash })).error.code).toBe('VALIDATION_REQUIRED');
  await f.service.execute('validate', { taskId }); await f.service.jobs.get(taskId);
  const saved = await f.service.execute('knowledge-save', { taskId, expectedHash: known.hash, notes: 'Example query verified.' });
  expect(saved.ok).toBe(true); expect(saved.data.knowledge.endpoints).toHaveLength(1);
  expect(JSON.stringify(saved)).not.toMatch(/placeholder-person|placeholder-id|placeholder-secret/);
  const restored = new ExplorationService(f.options);
  expect((await restored.execute('knowledge-read', { site: 'example.com' })).data.knowledge.notes[0].text).toBe('Example query verified.');
});

async function installedForRepair(f, { withKnowledge = true } = {}) {
  const taskId = await draft(f.service);
  const tool = f.service.runs.get(taskId).draft.toolNames[0];
  const verification = (await f.service.execute('verification-read', { taskId, tool })).data;
  await f.service.execute('verification-write', { taskId, tool, expectedHash: verification.hash,
    cases: [{ id: 'example-query', args: {}, expect: { requiredPaths: ['data'] } }] });
  await f.service.execute('validate', { taskId }); await f.service.jobs.get(taskId);
  const review = (await f.service.execute('review', { taskId })).data;
  await f.service.execute('install', { taskId, reviewId: review.reviewId, confirmed: true }); await f.service.jobs.get(taskId);
  expect(f.service.runs.get(taskId).status).toBe('installed');
  if (withKnowledge) {
    const known = (await f.service.execute('knowledge-read', { site: 'example.com' })).data;
    expect((await f.service.execute('knowledge-save', { taskId, expectedHash: known.hash })).ok).toBe(true);
  }
  const info = (await f.service.execute('repair-info', { site: 'example.com' })).data;
  const id = tool.slice('example.com.'.length);
  const plan = { tools: [{ name: id, risk: 'read', sourceApiKind: 'list', sourceApiIndexes: [0] }] };
  const repairId = await start(f.service, 'example-repair');
  const args = { taskId: repairId, site: info.site, expectedDigest: info.digest, plan };
  return { taskId: repairId, info, args, tool, id };
}

it('repairs only selected installed commands, imports cases, revalidates and publishes without changing shared files', async () => {
  const f = setup(); const { taskId, info, args, tool } = await installedForRepair(f);
  const before = readPackageDirectory(buildAdapterCatalog({ paths: f.paths }).effective[0].root);
  const created = await f.service.execute('repair', args);
  expect(created).toMatchObject({ ok: true, data: { status: 'draft', repair: { digest: info.digest, knowledge: { importedTools: [tool] } } } });
  const run = f.service.runs.get(taskId);
  const file = run.editableFiles.find(file => file !== 'manifest.json');
  const old = (await f.service.execute('draft-read', { taskId, file })).data;
  await f.service.execute('draft-write', { taskId, file, expectedHash: old.hash, content: old.content + '\n// Example repair\n' });
  // Author-controlled evidence cannot grant a repair exception to other callers.
  expect(() => verifyRetainedPackage(readPackageDirectory(run.draft.adapterDir), readGenerationEvidence(run.draft.adapterDir), { paths: f.paths })).toThrow(/已有工具文件/);
  const restored = new ExplorationService(f.options);
  expect((await restored.execute('get', { taskId })).data.repair.commandIds).toEqual([args.plan.tools[0].name]);
  await restored.execute('validate', { taskId }); await restored.jobs.get(taskId);
  expect((await restored.execute('get', { taskId })).data.status).toBe('review_ready');
  const review = (await restored.execute('review', { taskId })).data;
  expect(review.repair.commandIds).toEqual(run.repairScope.commandIds);
  await restored.execute('install', { taskId, reviewId: review.reviewId, confirmed: true }); await restored.jobs.get(taskId);
  expect((await restored.execute('get', { taskId })).data.status).toBe('installed');
  const after = readPackageDirectory(buildAdapterCatalog({ paths: f.paths }).effective[0].root);
  for (const [name, contents] of before.files) if (!run.editableFiles.includes(name)) expect(after.files.get(name)).toEqual(contents);
  expect(after.digest).not.toBe(before.digest);
  expect(after.manifest.commands).toEqual(before.manifest.commands);
});

it('refuses protected files, added helpers and manifest changes outside the selected schema/description', async () => {
  const f = setup(); const { taskId, args } = await installedForRepair(f);
  expect((await f.service.execute('repair', { ...args, expectedDigest: 'stale' })).error.code).toBe('ADAPTER_BASE_CHANGED');
  expect((await f.service.execute('repair', { ...args, plan: { tools: [{ ...args.plan.tools[0], name: 'missing-command' }] } })).error.code).toBe('REPAIR_SCOPE_CHANGED');
  expect((await f.service.execute('repair', args)).ok).toBe(true);
  const run = f.service.runs.get(taskId), read = file => f.service.execute('draft-read', { taskId, file });
  const protectedFile = run.draftFiles.find(file => file.startsWith('extension/internal/'));
  const prior = (await read(protectedFile)).data;
  expect((await f.service.execute('draft-write', { taskId, file: protectedFile, expectedHash: prior.hash, content: prior.content + '\n' })).error.code).toBe('REPAIR_SCOPE_CHANGED');
  expect((await f.service.execute('draft-add', { taskId, file: 'extension/internal/new-helper.js', content: '' })).error.code).toBe('REPAIR_SCOPE_CHANGED');
  const original = (await read('manifest.json')).data.content;
  for (const change of [
    manifest => manifest.match.push('example.org'),
    manifest => { manifest.commands.find(item => item.id === args.plan.tools[0].name).safety = 'write'; },
    manifest => { manifest.commands.find(item => item.id !== args.plan.tools[0].name).description += ' modified'; },
  ]) {
    const manifest = JSON.parse(original); change(manifest);
    const current = (await read('manifest.json')).data;
    await f.service.execute('draft-write', { taskId, file: 'manifest.json', expectedHash: current.hash, content: JSON.stringify(manifest) });
    await f.service.execute('validate', { taskId }); await f.service.jobs.get(taskId);
    expect((await f.service.execute('get', { taskId })).data.validation.passed).toBe(false);
    expect((await f.service.execute('review', { taskId })).ok).toBe(false);
  }
});

it('requires authored cases for repairs and refuses a baseline changed after validation', async () => {
  const f = setup(); const { taskId, args, tool } = await installedForRepair(f, { withKnowledge: false });
  await f.service.execute('repair', args);
  expect((await f.service.execute('validate', { taskId })).error.code).toBe('VERIFICATION_REQUIRED');
  const cases = (await f.service.execute('verification-read', { taskId, tool })).data;
  await f.service.execute('verification-write', { taskId, tool, expectedHash: cases.hash,
    cases: [{ id: 'query', args: {}, expect: { requiredPaths: ['data'] } }] });
  await f.service.execute('validate', { taskId }); await f.service.jobs.get(taskId);
  expect((await f.service.execute('get', { taskId })).data.status).toBe('review_ready');
  const active = buildAdapterCatalog({ paths: f.paths }).effective[0];
  const manifestPath = path.join(active.root, 'manifest.json');
  fs.appendFileSync(manifestPath, '\n');
  expect((await f.service.execute('review', { taskId })).ok).toBe(false);
});

it('generates and installs a page-only command without API candidates, requiring fresh observation and authored cases', async () => {
  const f = setup({ capabilities: () => ({ connected: true, capabilities: ['passive_exploration_v1', 'strict_output_contract_v1', 'page_sources_v1'] }) });
  const original = f.requestExtension.getMockImplementation();
  f.requestExtension.mockImplementation(async msg => msg.type === 'exploration_capture_passive' ? { entries: [] }
    : msg.type === 'exploration_observe_page' ? { ok: true, shape: { type: 'array', length: 1, items: { type: 'string', value: 'example-private-content' } } } : original(msg));
  const taskId = await start(f.service);
  expect((await f.service.execute('generate', { taskId })).error.code).toBe('NO_READ_EVIDENCE');
  const source = { strategy: 'DOM_STATE', path: ['exampleState', 'items'] };
  await f.service.execute('observe', { taskId, source, reason: 'Public item state has no API endpoint.' }); await f.service.jobs.get(taskId);
  const evidence = (await f.service.execute('evidence', { taskId })).data;
  expect(evidence.candidates).toEqual([]); expect(evidence.pageSources).toHaveLength(1);
  expect(JSON.stringify(evidence)).not.toContain('example-private-content');
  const plan = { tools: [{ name: 'read_page', risk: 'read', strategy: 'DOM_STATE', sourcePageId: evidence.pageSources[0].id, readReason: 'Only reads the observed public state.' }] };
  const generated = await f.service.execute('generate', { taskId, plan }); expect(generated.ok).toBe(true);
  const run = f.service.runs.get(taskId);
  expect(readGenerationEvidence(run.draft.adapterDir).commands['read-page'].generationSource.version).toBe('page-source-v1');
  expect((await f.service.execute('validate', { taskId })).error.code).toBe('VERIFICATION_REQUIRED');
  const tool = generated.data.toolNames[0], current = (await f.service.execute('verification-read', { taskId, tool })).data;
  await f.service.execute('verification-write', { taskId, tool, expectedHash: current.hash, cases: [{ id: 'items', args: {}, expect: { types: { data: 'array' }, rowCount: { path: 'data', min: 1 } } }] });
  await f.service.execute('validate', { taskId }); await f.service.jobs.get(taskId);
  expect((await f.service.execute('get', { taskId })).data.status).toBe('review_ready');
  const review = (await f.service.execute('review', { taskId })).data;
  await f.service.execute('install', { taskId, reviewId: review.reviewId, confirmed: true }); await f.service.jobs.get(taskId);
  expect((await f.service.execute('get', { taskId })).data.status).toBe('installed');
  const known = (await f.service.execute('knowledge-read', { site: 'example.com' })).data;
  const saved = await f.service.execute('knowledge-save', { taskId, expectedHash: known.hash });
  expect(saved.data.knowledge.endpoints).toEqual([]); expect(saved.data.knowledge.pages).toHaveLength(1);
  expect(new ExplorationService(f.options).runs.get(taskId).pageSources[0].id).toBe(evidence.pageSources[0].id);
});

it('combines API and page plans and rejects mismatched page strategy or stale observations', async () => {
  const f = setup({ capabilities: () => ({ connected: true, capabilities: ['passive_exploration_v1', 'strict_output_contract_v1', 'page_sources_v1'] }) });
  const original = f.requestExtension.getMockImplementation();
  f.requestExtension.mockImplementation(async msg => msg.type === 'exploration_observe_page' ? { ok: true, shape: { type: 'object' } } : original(msg));
  const taskId = await start(f.service);
  await f.service.execute('observe', { taskId, source: { strategy: 'UI_SELECTOR', selector: '.item', fields: { title: {} } }, reason: 'Read visible rows.' }); await f.service.jobs.get(taskId);
  const sourcePageId = f.service.runs.get(taskId).pageSources[0].id;
  const tool = { name: 'page_items', risk: 'read', sourcePageId, strategy: 'UI_SELECTOR', readReason: 'Only reads visible rows.' };
  for (const changed of [{ strategy: 'DOM_STATE' }, { sourcePageId: 'page-v1-missing' }, { sourceApiIndexes: [0] }]) {
    expect((await f.service.execute('generate', { taskId, plan: { tools: [{ ...tool, ...changed }] } })).error.code).toBe('INVALID_PLAN');
  }
  const plan = { tools: [tool, { name: 'api_items', risk: 'read', sourceApiKind: 'list', sourceApiIndexes: [0] }] };
  const result = await f.service.execute('generate', { taskId, plan }); expect(result.ok).toBe(true);
  const sources = readGenerationEvidence(f.service.runs.get(taskId).draft.adapterDir).commands;
  expect(sources['page-items'].generationSource.version).toBe('page-source-v1');
  expect(sources['api-items'].generationSource.version).toBe('api-source-v2');
  expect((await f.service.execute('observe', { taskId, source: {}, reason: 'Changed' })).error.code).toBe('INVALID_STATE');
});
