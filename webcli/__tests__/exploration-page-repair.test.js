import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ExplorationService } from '../exploration-service.js';
import { resolveAdapterPaths } from '../paths.js';
import { readPackageDirectory } from '../adapter-package-files.js';
import { verifyRepairRetention } from '../generation-harness/existing-site.js';
import { resolveAdapterCall } from '../adapter-host.js';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const origin = 'https://example.com', url = origin + '/items/example';
async function setup(ui) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'page-repair-test-')); roots.push(root);
  const paths = resolveAdapterPaths({ home: root, env: { WEWORKER_USER_ADAPTERS_DIR: path.join(root, 'user'), WEWORKER_ADAPTER_DATA_DIR: path.join(root, 'data'), WEWORKER_BUILTIN_ADAPTERS_DIR: path.join(root, 'builtin'), WEWORKER_BUILD_PROFILE: 'public' } });
  const requests = []; let title = 'Before', hook;
  const options = { rootDir: path.join(root, 'tasks'), paths,
    capabilities: () => ({ connected: true, capabilities: ['passive_exploration_v1', 'page_write_v1', 'ui_write_v1'] }),
    requestExtension: async msg => {
      if (msg.type === 'exploration_list_tabs') { await hook?.(); return { tabs: [{ id: 7, url: origin + '/editor' }] }; }
      if (msg.type !== 'exploration_page_write') return { network: { entries: [] } };
      const request = msg.payload.request; requests.push(request);
      if (request.method !== 'GET') title = request.body.title || request.body.label;
      return { ok: true, document: { frameId: 'example', loaderId: 'example', url: origin + '/editor' }, value: ui && request.method !== 'GET'
        ? { ok: true, submitted: true, confirmationMatched: true, effectVerified: false } : { ok: true, id: 'example', title } };
    } };
  const service = new ExplorationService(options);
  async function task(requestId) {
    const taskId = (await service.execute('start', { tabId: 7, goal: 'Repair a public example', requestId })).data.taskId;
    await service.jobs.get(taskId);
    const call = async (name, args = {}) => { const reply = await service.execute(name, { taskId, ...args }); await service.jobs.get(taskId); return reply; };
    return { taskId, call, run: service.runs.get(taskId) };
  }
  const original = await task('original');
  await original.call('declare-write', { url, method: 'POST', bodyKeys: ['title'], reason: 'Public example' });
  const toolPlan = { name: 'update-title', risk: 'write', strategy: ui ? 'UI_SELECTOR' : 'PAGE_FETCH', sourceApiKind: 'action', sourceApiIndexes: [0], pagePathname: '/editor',
    ...(ui ? { uiWrite: { form: '#form', inputMode: 'native-setter-no-events', inputs: [{ selector: '#title', name: 'title', parameter: 'title' }], submit: { selector: '#save', text: 'Save' }, confirmation: { selector: '#receipt', attribute: 'data-title', parameter: 'title' } } }
      : { bodyParameters: { title: 'title' }, idempotency: { header: 'idempotency-key', serverDeduplicates: true } }),
    writeReason: 'Update public example', strategyNote: { reason: 'Explicit fixture contract', alternatives: 'No separate public endpoint', limitations: 'Single write' } };
  expect((await original.call('generate', { plan: { tools: [toolPlan] } })).ok).toBe(true);
  const tool = original.run.draft.toolNames[0];
  const fixture = { id: 'example', representativeArgs: { title: 'After' },
    ...(ui ? { expectedSubmission: { url, method: 'POST', body: { title: 'After' } } } : { expectedRequest: { url, method: 'POST', body: { title: 'After' } }, successResponse: { status: 200, body: { ok: true, title: 'After' } }, successExpectation: { ok: true, title: 'After' }, failureResponse: { status: 409, body: {} }, failureExpectation: { ok: false, errorCode: 'PAGE_WRITE_HTTP_STATUS' } }),
    effect: { readback: { url }, before: { equals: { id: 'example', title: 'Before' } }, after: { equals: { id: 'example', title: 'After' } }, ...(ui ? { identityPath: 'id', argumentPaths: { title: 'title' } } : {}) } };
  const save = async (t, value) => t.call('write-verification-write', { tool, fixture: value, expectedHash: (await t.call('write-verification-read', { tool })).data.hash });
  await save(original, fixture); await original.call('validate');
  const oldReview = (await original.call('write-review', { tool })).data;
  await original.call('write-verify', { tool, reviewId: oldReview.reviewId, confirmed: true });
  expect(original.run.status).toBe('review_ready');
  const review = (await original.call('review')).data;
  await original.call('install', { reviewId: review.reviewId, confirmed: true });
  expect(original.run.status).toBe('installed');
  const knowledge = (await service.execute('knowledge-read', { site: original.run.siteKey })).data;
  await original.call('knowledge-save', { expectedHash: knowledge.hash });
  const info = (await service.execute('repair-info', { site: original.run.siteKey })).data;
  title = 'Before'; requests.length = 0;
  const repair = await task('repair');
  const nextPlan = structuredClone(toolPlan);
  if (ui) nextPlan.uiWrite.inputs[0].selector = '#renamed-title';
  else nextPlan.bodyParameters = { label: 'title' };
  await repair.call('declare-write', { url, method: 'POST', bodyKeys: [ui ? 'title' : 'label'], reason: 'Fresh contract for public fixture' });
  const repairArgs = { site: info.site, expectedDigest: info.digest, plan: { tools: [nextPlan] } };
  return { service, paths, requests, original, repair, repairArgs, info, oldReview, fixture, tool, save, options, setHook: value => { hook = value; } };
}

it.each([false, true])('repairs exact declarative contracts with fresh validation and authorization (UI=%s)', async ui => {
  const f = await setup(ui), r = f.repair;
  expect(await r.call('repair', f.repairArgs)).toMatchObject({ ok: true });
  expect(f.requests).toEqual([]); expect(r.run.writeExecutions || []).toEqual([]);
  expect(r.run.repairKnowledge.importedWriteTools).toEqual(ui ? [f.tool] : []);
  if (!ui) {
    expect(r.run.repairKnowledge.skippedWriteTools).toEqual([{ tool: f.tool, code: 'INVALID_WRITE_CASE' }]);
    const fixture = structuredClone(f.fixture); fixture.expectedRequest.body = { label: 'After' };
    expect((await f.save(r, fixture)).ok).toBe(true);
  }
  await r.call('validate'); expect(r.run.status, JSON.stringify(r.run.validation)).toBe('write_review_ready');
  const review = (await r.call('write-review', { tool: f.tool })).data;
  expect(review.repair.authorizationInherited).toBe(false); expect(review.reviewId).not.toBe(f.oldReview.reviewId);
  expect((await r.call('write-verify', { tool: f.tool, reviewId: f.oldReview.reviewId, confirmed: true })).error.code).toBe('STALE_REVIEW');
  expect((await r.call('write-verify', { tool: f.tool, reviewId: review.reviewId })).error.code).toBe('CONFIRMATION_REQUIRED');
  expect(f.requests).toEqual([]);
  await r.call('write-verify', { tool: f.tool, reviewId: review.reviewId, confirmed: true });
  expect(r.run.status, JSON.stringify(r.run.writeExecutions)).toBe('review_ready');
  expect(f.requests.map(v => v.method)).toEqual(['GET', 'POST', 'GET']);
  const install = (await r.call('review')).data;
  expect(install.permissions.some(v => v.startsWith(ui ? 'ui-write:' : 'page-write:'))).toBe(true);
  await r.call('install', { reviewId: install.reviewId, confirmed: true }); expect(r.run.status).toBe('installed');
  const restored = new ExplorationService(f.options);
  await restored.execute('write-verify', { taskId: r.taskId, tool: f.tool, reviewId: review.reviewId, confirmed: true });
  expect(f.requests).toHaveLength(3);
});

it.each([false, true])('prevents scope, shared file, runtime and contract escalation (UI=%s)', async ui => {
  const f = await setup(ui), r = f.repair;
  expect((await r.call('repair', f.repairArgs)).ok).toBe(true);
  const before = readPackageDirectory(f.original.run.draft.adapterDir), pkg = readPackageDirectory(r.run.draft.adapterDir);
  // The installed package has the same digest as the original validated draft.
  for (const mutate of [p => { p.manifest.commands[0].pageRoute.pathname = '/unreviewed'; },
    p => { p.manifest.commands[0][ui ? 'uiWrite' : 'pageWrite'].url = origin + '/other'; },
    p => { p.manifest.commands[0].runtime = 'http'; },
    p => { const shared = [...p.files.keys()].find(v => v !== 'manifest.json' && v !== p.manifest.commands[0].module); p.files.set(shared, Buffer.from('changed')); }]) {
    const next = { ...pkg, files: new Map(pkg.files), manifest: structuredClone(pkg.manifest) }; mutate(next);
    expect(() => verifyRepairRetention(before, next, r.run.repairScope)).toThrow();
  }
  expect(() => verifyRepairRetention(before, pkg, { ...r.run.repairScope, pageWriteContracts: {} })).toThrow();
  expect(() => verifyRepairRetention(before, pkg, { ...r.run.repairScope, writeCommandIds: [] })).toThrow();
});

it.each(['method', 'idempotency', 'origin', 'strategy'])('rejects a repair that changes the installed %s boundary', async change => {
  const f = await setup(false), args = structuredClone(f.repairArgs);
  if (change === 'idempotency') args.plan.tools[0].idempotency.header = 'x-idempotency-key';
  else if (change === 'strategy') args.plan.tools[0].strategy = 'PUBLIC_API';
  else {
    await f.repair.call('declare-write', { url: change === 'origin' ? 'https://example.org/items/example' : url, method: 'PUT', bodyKeys: ['label'], reason: 'Explicit changed example' });
    if (change === 'origin') {
      // A same-host/different-origin source must not be inferred as authorized.
      const reply = await f.repair.call('declare-write', { url: 'https://example.org/items/example', method: 'POST', bodyKeys: ['label'], reason: 'Example declaration' });
      expect(reply.ok).toBe(false); expect(f.requests).toEqual([]); return;
    }
    args.plan.tools[0].sourceApiIndexes = [1];
  }
  expect((await f.repair.call('repair', args)).ok).toBe(false);
  expect(f.requests).toEqual([]);
});

it.each([false, true])('rechecks installed baseline after the last async tab check before dispatch (UI=%s)', async ui => {
  const f = await setup(ui), r = f.repair;
  await r.call('repair', f.repairArgs);
  if (!ui) { const fixture = structuredClone(f.fixture); fixture.expectedRequest.body = { label: 'After' }; await f.save(r, fixture); }
  await r.call('validate'); const review = (await r.call('write-review', { tool: f.tool })).data;
  f.setHook(() => {
    if (!f.requests.length) return;
    const file = path.join(resolveAdapterCall(f.tool, { paths: f.paths }).adapter.root, 'manifest.json');
    const value = JSON.parse(fs.readFileSync(file)); value.version = '9.0.0'; fs.writeFileSync(file, JSON.stringify(value));
  });
  await r.call('write-verify', { tool: f.tool, reviewId: review.reviewId, confirmed: true });
  expect(f.requests.map(v => v.method)).toEqual(['GET']);
  expect(r.run.writeExecutions[0]).toMatchObject({ status: 'not_dispatched', error: { code: 'ADAPTER_BASE_CHANGED' } });
});
