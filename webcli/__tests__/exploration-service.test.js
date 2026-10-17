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
    const executable = message.testCases.filter(test => test.execute);
    expect(executable).toHaveLength(1);
    for (const test of executable) {
      const tool = tools.find(tool => tool.name === test.toolName);
      const output = await tool.handler(test.args || {});
      expect(output.ok).toBe(true);
    }
    return { passed: true, executionSummary: { attempted: executable.length, passed: executable.length, failed: 0, skipped: 0 } };
  });
  const taskId = await draft(f.service);
  await f.service.execute('validate', { taskId }); await f.service.jobs.get(taskId);
  expect((await f.service.execute('get', { taskId })).data.status).toBe('review_ready');
  expect(requests).toEqual(['https://example.com/api/list']);
  const review = (await f.service.execute('review', { taskId })).data;
  await f.service.execute('install', { taskId, reviewId: review.reviewId, confirmed: true }); await f.service.jobs.get(taskId);
  expect((await f.service.execute('get', { taskId })).data.status).toBe('installed');
});
