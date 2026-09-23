import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { GenerationHarness, GenerationRunStore, createAdapterGenerationWorkflow, createAdapterGenerationResumeWorkflow, createAdapterPublisher } from '../generation-harness/index.js';
import { buildQuickGenerationPlan } from '../generation-harness/quick-generation.js';
import { buildAdapterCatalog } from '../adapter-catalog.js';
import { readPackageDirectory } from '../adapter-package-files.js';
import { GenerationWorkerController } from '../generation-worker-controller.js';
import { installAdapter } from '../adapter-install-store.js';
import { WebSocketBridge } from '../bridge.js';

const roots = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const memory = { siteKey: 'example.com', siteHost: 'example.com', siteOrigin: 'https://example.com', canonicalEntryUrl: 'https://example.com/',
  listApiCandidates: [{ url: 'https://example.com/api/delete', method: 'GET' }, { url: 'https://example.com/api/list', method: 'GET' }],
  actionApiCandidates: [ { toolName: 'example.com.submit_item', actionName: 'submit', url: 'https://example.com/api/submit', method: 'POST' },
    { toolName: 'example.com.get_count', actionName: 'get count', url: 'https://example.com/api/count', method: 'GET' } ],
};
function fixture(runtimeValidator = vi.fn(async () => ({ passed: true }))) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-generation-')); roots.push(root);
  for (const [key, value] of Object.entries({ WEWORKER_USER_ADAPTERS_DIR: path.join(root, 'user'), WEBCLI_ADAPTERS_DIR: path.join(root, 'user'), WEWORKER_ADAPTER_DATA_DIR: path.join(root, 'data'), WEWORKER_BUILTIN_ADAPTERS_DIR: path.join(root, 'builtin'), WEWORKER_BUILD_PROFILE: 'public' })) vi.stubEnv(key, value);
  const store = new GenerationRunStore({ rootDir: path.join(root, 'runs') });
  const model = vi.fn(() => { throw new Error('Quick mode must not invoke a model.'); });
  const harness = new GenerationHarness({ store, workflow: createAdapterGenerationWorkflow({ model, runtimeValidator }), resumeWorkflow: createAdapterGenerationResumeWorkflow({ model, runtimeValidator }), publisher: createAdapterPublisher() });
  return { root, store, model, harness, runtimeValidator };
}
const start = harness => harness.start({ siteKey: memory.siteKey, goal: 'Quick fixture', input: { mode: 'quick', memory, tabId: 7 } });

it('binds read candidates to their original list/action indexes and excludes mutations including GET', () => {
  expect(buildQuickGenerationPlan(memory).tools).toMatchObject([
    { risk: 'read', sourceApiKind: 'list', sourceApiIndexes: [1] },
    { risk: 'read', sourceApiKind: 'action', sourceApiIndexes: [1] },
  ]);
  expect(() => buildQuickGenerationPlan({ listApiCandidates: [memory.listApiCandidates[0]], actionApiCandidates: [memory.actionApiCandidates[0]] })).toThrow(/智能生成/);
});

it('generates an isolated package without model calls and installs only through explicit publication', async () => {
  const { harness, store, model, runtimeValidator, root } = fixture();
  const run = start(harness);
  const awaiting = await harness.wait(run.id);
  expect(awaiting.status).toBe('awaiting_approval');
  expect(awaiting.modelCallCount).toBe(0);
  expect(model).not.toHaveBeenCalled();
  expect(runtimeValidator).toHaveBeenCalledOnce();
  expect(buildAdapterCatalog().effective).toEqual([]);
  const draft = store.load(run.id).artifacts.draft;
  const pkg = readPackageDirectory(draft.adapterDir);
  expect(pkg.commands.map(command => command.name)).toContain('example.com.query-action-2');
  expect(pkg.files.get('extension/commands/query-action-2.js').toString()).toContain('/api/count');
  expect(fs.existsSync(path.join(root, 'builtin/example.com'))).toBe(false);
  harness.publish(run.id);
  expect((await harness.wait(run.id)).status).toBe('completed');
  expect(buildAdapterCatalog().effective[0].digest).toBe(pkg.digest);
});

it('resumes page validation using the same draft and baseline without recreating a package or model budget', async () => {
  const runtimeValidator = vi.fn().mockResolvedValueOnce({ passed: false, errors: [{ code: 'TARGET_TAB_NOT_FOUND' }] }).mockResolvedValueOnce({ passed: true });
  const { harness, store, model } = fixture(runtimeValidator);
  const run = start(harness);
  expect((await harness.wait(run.id)).status).toBe('needs_user_input');
  const before = store.load(run.id).artifacts.draft;
  const digest = readPackageDirectory(before.adapterDir).digest;
  await harness.resume(run.id, 'Fixture page is ready.');
  expect((await harness.wait(run.id)).status).toBe('awaiting_approval');
  const after = store.load(run.id);
  expect(after.artifacts.draft).toEqual(before);
  expect(readPackageDirectory(before.adapterDir).digest).toBe(digest);
  expect(after.stepCount).toBe(4);
  expect(model).not.toHaveBeenCalled();
});

it('routes the legacy quick RPC to a tracked run instead of writing a source adapter', async () => {
  const bridge = Object.create(WebSocketBridge.prototype);
  bridge._generationWorkers = { start: vi.fn(async () => ({ id: 'fixture-run', status: 'planning' })) };
  const send = vi.fn();
  await bridge._handleGenerateAdapterScaffold({ type: 'generate_adapter_scaffold', id: 'fixture-request', siteKey: memory.siteKey, memory, tabId: 7 }, { send });
  expect(bridge._generationWorkers.start).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ mode: 'quick', tabId: 7 }) }), undefined);
  expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({ type: 'generate_adapter_scaffold_result', ok: true, run: { id: 'fixture-run' } });
});


it('keeps a stale installation review pending and accepts only the refreshed review', async () => {
  const { harness } = fixture();
  const run = start(harness);
  const awaiting = await harness.wait(run.id);
  const first = awaiting.artifacts.installationReview;
  expect(first).toMatchObject({ name: 'example.com', version: '1.0.0', targetSource: 'generated' });
  // A separate package changes the registry revision without changing this draft's baseline.
  const other = new Map([
    ['manifest.json', Buffer.from(JSON.stringify({ schema_version: 2, name: 'other', version: '1.0.0', description: 'Fixture', match: ['example.org'], commands: [{ id: 'list', runtime: 'extension', module: 'extension/commands/list.js', description: 'Fixture', safety: 'read', schema: { type: 'object', properties: {} } }] }))],
    ['extension/commands/list.js', Buffer.from('/* fixture */')],
  ]);
  installAdapter({ files: other });
  harness.publish(run.id, { reviewId: first.reviewId, acceptChanges: true });
  const pending = await harness.wait(run.id);
  expect(pending.status).toBe('awaiting_approval');
  expect(pending.lastError.code).toBe('ADAPTER_REVIEW_CHANGED');
  expect(pending.artifacts.installationReview.reviewId).not.toBe(first.reviewId);
  expect(buildAdapterCatalog().effective.map(item => item.name)).toEqual(['other']);
  harness.publish(run.id, { reviewId: pending.artifacts.installationReview.reviewId, acceptChanges: true });
  expect((await harness.wait(run.id)).status).toBe('completed');
});

it('requires the concrete review to switch from local installation to generated updates', async () => {
  const { harness, store } = fixture();
  const initial = start(harness);
  const first = await harness.wait(initial.id);
  installAdapter({ directory: store.load(initial.id).artifacts.draft.adapterDir, origin: { kind: 'local' } });
  const run = start(harness);
  const awaiting = await harness.wait(run.id);
  expect(awaiting.artifacts.installationReview).toMatchObject({ currentSource: 'local', sourceChange: true });
  harness.publish(run.id);
  const pending = await harness.wait(run.id);
  expect(pending.status).toBe('awaiting_approval');
  expect(pending.lastError.code).toBe('ADAPTER_INSTALL_REVIEW_REQUIRED');
  harness.publish(run.id, { reviewId: pending.artifacts.installationReview.reviewId, acceptChanges: true });
  expect((await harness.wait(run.id)).status).toBe('completed');
  expect(buildAdapterCatalog().effective[0].origin.kind).toBe('generated');
});


it('real Worker resumes a quick draft and installs with review approval without a model', async () => {
  const { root, store } = fixture();
  let pageReady = false;
  const controller = new GenerationWorkerController({
    store, workerScript: path.resolve(import.meta.dirname, '../index.js'), reportDir: path.join(root, 'reports'),
    requestExtension: async message => {
      expect(message.type).toBe('validate_generation_preview');
      expect(message.tabId).toBe(7);
      if (!pageReady) return { passed: false, errors: [{ code: 'TARGET_TAB_NOT_FOUND' }] };
      return { passed: true, tools: [], executionSummary: { attempted: 0, skipped: 0 } };
    },
  });
  const settle = async id => {
    const deadline = Date.now() + 15000;
    while (controller.activeWorkers.has(id) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    expect(controller.activeWorkers.has(id)).toBe(false);
    return controller.get(id);
  };
  let id;
  try {
    const started = await controller.start({ siteKey: memory.siteKey, goal: 'Quick Worker fixture', input: { mode: 'quick', memory, tabId: 7 } });
    id = started.id;
    expect((await settle(id)).status).toBe('needs_user_input');
    const before = store.load(id).artifacts.draft;
    pageReady = true;
    await controller.resume(id, 'Fixture page is ready');
    const awaiting = await settle(id);
    expect(awaiting.status).toBe('awaiting_approval');
    expect(awaiting.modelCallCount).toBe(0);
    expect(store.load(id).artifacts.draft).toEqual(before);
    const installed = await controller.publish(id, { reviewId: awaiting.artifacts.installationReview.reviewId, acceptChanges: true });
    expect(installed.status).toBe('completed');
    expect(buildAdapterCatalog().effective[0].digest).toBe(awaiting.artifacts.installationReview.digest);
  } finally {
    if (id && controller.activeWorkers.has(id)) await controller.cancel(id, 'Fixture cleanup');
  }
}, 30000);
