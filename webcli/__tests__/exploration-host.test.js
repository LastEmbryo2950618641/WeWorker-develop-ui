import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { ExplorationService } from '../exploration-service.js';
import { resolveAdapterPaths } from '../paths.js';
import { resolveAdapterCall } from '../adapter-host.js';
import { runHttpTool } from '../http-runner.js';
import { discoverOpenApi } from '../exploration-openapi.js';

const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.unstubAllEnvs(); });
async function setup(auth = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exploration-host-'));
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const requests = []; let drift = false;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, method: req.method, body, authorization: req.headers.authorization });
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/slow') return;
    if (url.pathname === '/next') { res.writeHead(302, { location: '/delete' }); res.end(); return; }
    if (url.pathname === '/redirect') { res.writeHead(302, { location: '/list?id=008' }); res.end(); return; }
    if (url.pathname === '/denied') { res.writeHead(401); res.end('{"secret":"example-response-private"}'); return; }
    if (url.pathname === '/invalid') { res.end('{bad json'); return; }
    if (url.pathname === '/openapi.json') { res.end(JSON.stringify({ openapi: '3.1.0', info: { title: 'example-private-document-text' }, servers: [{ url: '/' }],
      paths: { '/list': { get: { operationId: 'listItems', parameters: [{ name: 'id', in: 'query', schema: { type: 'string', example: 'example-private-parameter' } }],
        responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' }, example: { secret: 'example-private-body' } } } } } } },
        '/delete': { post: { responses: {} } } }, components: { schemas: { Result: { type: 'object', properties: { id: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' } } } } } } } } })); return; }
    const id = url.searchParams.get('id') || (body ? JSON.parse(body).id : null);
    res.end(JSON.stringify({ [drift ? 'itemId' : 'id']: id, items: [{ title: 'example-private-response' }], auth: req.headers.authorization === 'Bearer example-host-placeholder' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const env = { WEWORKER_USER_ADAPTERS_DIR: path.join(root, 'user'), WEWORKER_ADAPTER_DATA_DIR: path.join(root, 'data'), WEWORKER_BUILTIN_ADAPTERS_DIR: path.join(root, 'builtin'), WEWORKER_BUILD_PROFILE: 'public' };
  const paths = resolveAdapterPaths({ home: root, env });
  const requestExtension = vi.fn(async () => { throw new Error('No browser allowed'); });
  const options = { mode: 'http', rootDir: path.join(root, 'tasks'), paths, requestExtension };
  const service = new ExplorationService(options);
  const start = { mode: 'http', origin, goal: 'Read example items', requestId: 'example-host-task',
    ...(auth ? { auth: { type: 'bearer', origin, env: 'EXAMPLE_HOST_API_KEY' } } : {}) };
  if (auth) vi.stubEnv('EXAMPLE_HOST_API_KEY', 'example-host-placeholder');
  const response = await service.execute('start', start);
  expect(response).toMatchObject({ ok: true, data: { mode: 'http', status: 'evidence_ready', tabId: null } });
  const taskId = response.data.taskId;
  const plan = { tools: [{ name: 'items', risk: 'read', sourceApiKind: 'list', sourceApiIndexes: [0], strategy: auth ? 'AUTH_API' : 'PUBLIC_API',
    ...(auth ? { auth: start.auth } : {}), readReason: 'Observed read-only GET response', strategyNote: { reason: 'Explicit host HTTP evidence', limitations: 'Example endpoint only' } }] };
  async function call(command, args = {}) {
    const result = await service.execute(command, { taskId, ...args });
    if (service.jobs.has(taskId)) await service.jobs.get(taskId);
    return result;
  }
  return { root, origin, paths, requests, requestExtension, service, options, start, taskId, plan, call, drift: () => { drift = true; } };
}

it.each([false, true])('completes browser-free discovery, real requests, generation, cases, install and repair (auth=%s)', async auth => {
  const f = await setup(auth);
  expect(f.requests).toHaveLength(0);
  expect((await f.call('discover', { url: f.origin + '/openapi.json', reason: 'Inspect the published API declaration' })).ok).toBe(true);
  const evidence = (await f.call('evidence')).data;
  expect(evidence.candidates).toHaveLength(0);
  expect(evidence.discoveries[0]).toMatchObject({ executedOperations: 0, structuralOnly: true });
  expect(evidence.discoveries[0].operations).toHaveLength(2);
  expect(JSON.stringify(evidence)).not.toContain('example-private');
  expect(f.requests).toHaveLength(1);
  expect((await f.call('generate', { plan: f.plan })).error.code).toBe('NO_READ_EVIDENCE');
  await f.call('request', { request: { url: f.origin + '/list?id=example-private-input' }, reason: 'Read the documented list' });
  const observed = (await f.call('evidence')).data.candidates[0];
  expect(observed.observation.mode).toBe('http');
  expect(observed.sourceEvidence.sourceKind).toBe('host_http');
  expect(observed.responseEvidence.bodyKind).toBe('json');
  expect((await f.call('generate', { plan: f.plan })).ok).toBe(true);
  const tool = f.service.runs.get(f.taskId).draft.toolNames[0];
  const before = await f.call('verification-read', { tool });
  const cases = ['007', '008'].map(id => ({ id: 'example-' + id, args: { id }, expect: { equals: { id, auth } } }));
  await f.call('verification-write', { tool, cases, expectedHash: before.data.hash });
  expect((await f.call('validate')).ok).toBe(true);
  expect((await f.call('get')).data.status).toBe('review_ready');
  const review = await f.call('review');
  await f.call('install', { reviewId: review.data.reviewId, confirmed: true });
  expect((await f.call('get')).data.status).toBe('installed');
  const match = resolveAdapterCall(tool, { paths: f.paths });
  expect((await runHttpTool(match, { id: '009' })).result.id).toBe('009');
  const knowledge = await f.service.execute('knowledge-read', { site: match.adapter.name });
  await f.call('knowledge-save', { expectedHash: knowledge.data.hash });
  const restored = new ExplorationService(f.options);
  expect((await restored.execute('get', { taskId: f.taskId })).data.status).toBe('installed');
  const serialized = fs.readFileSync(path.join(f.options.rootDir, f.taskId + '.json'), 'utf8');
  expect(serialized).not.toMatch(/example-private|example-host-placeholder|Bearer /);
  f.drift();
  const repairStart = await f.service.execute('start', { ...f.start, requestId: 'example-host-repair' });
  const repairId = repairStart.data.taskId;
  await f.service.execute('request', { taskId: repairId, request: { url: f.origin + '/list?id=example' }, reason: 'Read changed endpoint' });
  await f.service.jobs.get(repairId);
  expect((await f.service.execute('repair', { taskId: repairId, site: match.adapter.name, expectedDigest: match.adapter.digest, plan: f.plan })).ok).toBe(true);
  await f.service.execute('validate', { taskId: repairId }); await f.service.jobs.get(repairId);
  expect(f.service.runs.get(repairId).runtimeSummary.passed).toBe(false);
  const file = 'http/commands/items.js';
  const draft = await f.service.execute('draft-read', { taskId: repairId, file });
  await f.service.execute('draft-write', { taskId: repairId, file, expectedHash: draft.data.hash,
    content: draft.data.content.replace('return api.request(request);', 'const result = await api.request(request); return {...result, id: result.itemId};') });
  await f.service.execute('validate', { taskId: repairId }); await f.service.jobs.get(repairId);
  expect(f.service.runs.get(repairId).status).toBe('review_ready');
  expect(f.requestExtension).not.toHaveBeenCalled();
});

it('persists starts idempotently, rejects browser actions and keeps HTTP tasks independent', async () => {
  const f = await setup();
  const responses = await Promise.all([f.service.execute('start', f.start), f.service.execute('start', f.start)]);
  expect(responses.every(result => result.data.taskId === f.taskId)).toBe(true);
  expect((await f.service.execute('start', { ...f.start, goal: 'other' })).error.code).toBe('REQUEST_CONFLICT');
  expect((await f.call('collect')).error.code).toBe('BROWSER_NOT_AVAILABLE');
  expect((await f.call('get', { mode: 'browser' })).error.code).toBe('MODE_MISMATCH');
  expect((await f.call('generate')).error.code).toBe('HTTP_PLAN_REQUIRED');
  expect((await f.call('generate', { plan: { tools: [{ ...f.plan.tools[0], strategy: 'COOKIE_API' }] } })).error.code).toBe('HTTP_PLAN_REQUIRED');
  expect(f.requests).toHaveLength(0);
});

it('rejects writes, unresolved POST and credential query inputs before dispatch; checks redirects again', async () => {
  const f = await setup();
  for (const request of [
    { url: f.origin + '/delete', method: 'GET' }, { url: f.origin + '/list', method: 'DELETE' },
    { url: f.origin + '/items', method: 'POST', json: { id: '007' } }, { url: f.origin + '/list?operation=delete' },
    { url: f.origin + '/search', method: 'POST', json: { action: 'delete' } },
    { url: f.origin + '/graphql', method: 'POST', json: { query: 'mutation { removeItem { id } }' } },
  ]) expect((await f.call('request', { request, reason: 'Example read request' })).error.code).toBe('READ_ONLY_REQUIRED');
  expect((await f.call('request', { request: { url: f.origin + '/list?token=example-placeholder' }, reason: 'Example' })).error.code).toBe('CREDENTIAL_INPUT_DENIED');
  expect((await f.call('request', { request: { url: 'https://example.com/list' }, reason: 'Example' })).error.code).toBe('HTTP_ORIGIN_DENIED');
  expect(f.requests).toHaveLength(0);
  // A benign initial path cannot hide a redirected mutation endpoint.
  await f.call('request', { request: { url: f.origin + '/redirect' }, reason: 'Example redirect' });
  expect(f.requests.map(item => item.url)).toEqual(['/redirect', '/list?id=008']);
  await f.call('request', { request: { url: f.origin + '/next' }, reason: 'Example redirect to unverified operation' });
  expect((await f.call('get')).data.error.code).toBe('READ_ONLY_REQUIRED');
  expect(f.requests.map(item => item.url)).toEqual(['/redirect', '/list?id=008', '/next']);
});

it('captures POST query/GraphQL request shape without values and does not persist denied response bodies', async () => {
  const f = await setup();
  await f.call('request', { request: { url: f.origin + '/search', method: 'POST', json: { id: 'example-private-body' } }, reason: 'Read-only search POST' });
  expect(f.service.runs.get(f.taskId).candidates[0].requestEvidence.bodyKind).toBe('json');
  await f.call('request', { request: { url: f.origin + '/graphql', method: 'POST', json: { query: 'query { items { id } }', id: 'example-private-body' } }, reason: 'GraphQL query only' });
  expect(f.service.runs.get(f.taskId).candidates[1].requestSemantics).toEqual({ kind: 'graphql', operation: 'query' });
  await f.call('request', { request: { url: f.origin + '/denied' }, reason: 'Inspect example access' });
  expect((await f.call('get')).data).toMatchObject({ status: 'failed', error: { code: 'HTTP_AUTH_REQUIRED' } });
  expect((await f.call('analyze')).data.candidates.some(candidate => candidate.verdict === 'blocked')).toBe(true);
  expect(fs.readFileSync(path.join(f.options.rootDir, f.taskId + '.json'), 'utf8')).not.toContain('example-private');
});

it('cancel aborts an in-flight HTTP request and restart marks interrupted without replay', async () => {
  const f = await setup();
  const response = await f.service.execute('request', { taskId: f.taskId, request: { url: f.origin + '/slow' }, reason: 'Read slow example' });
  expect(response.ok).toBe(true);
  await vi.waitFor(() => expect(f.requests).toHaveLength(1));
  const restored = new ExplorationService(f.options);
  expect((await restored.execute('get', { taskId: f.taskId })).data).toMatchObject({ status: 'interrupted', requestCount: 1 });
  await f.service.execute('cancel', { taskId: f.taskId }); await f.service.jobs.get(f.taskId);
  expect((await f.call('get')).data).toMatchObject({ status: 'cancelled', candidateCount: 0 });
  expect(f.requests).toHaveLength(1);
});

it('does not dispatch when host auth is missing; invalid JSON cannot become evidence', async () => {
  const f = await setup(true); vi.stubEnv('EXAMPLE_HOST_API_KEY', undefined);
  await f.call('request', { request: { url: f.origin + '/list' }, reason: 'Example' });
  expect((await f.call('get')).data.error.code).toBe('HTTP_CREDENTIALS_MISSING'); expect(f.requests).toHaveLength(0);
  vi.stubEnv('EXAMPLE_HOST_API_KEY', 'example-host-placeholder');
  await f.call('request', { request: { url: f.origin + '/invalid' }, reason: 'Example' });
  expect((await f.call('get')).data.error.code).toBe('HTTP_INVALID_JSON');
  expect((await f.call('evidence')).data.candidates).toHaveLength(0);
});

it('parses local refs and scoped server prefixes, reports remote/cyclic refs and strips scalar examples', () => {
  const document = { openapi: '3.0.3', servers: [{ url: '/v1' }, { url: 'https://example.org' }, { url: 'https://{host}/' }],
    paths: { '/items/{itemId}': { parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string', default: 'example-private' } }],
      get: { responses: { 200: { $ref: '#/components/responses/Example' } } } }, '/external': { get: { responses: { 200: { $ref: 'https://example.org/spec.json#/example' } } } } },
    components: { responses: { Example: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } } },
      schemas: { Item: { type: 'object', properties: { id: { type: 'string', example: 'example-private' }, child: { $ref: '#/components/schemas/Item' } } } } } };
  const result = discoverOpenApi(document, 'https://example.com/openapi.json', ['https://example.com']);
  expect(result.operations[0]).toMatchObject({ url: 'https://example.com/v1/items/:id', observed: false, pathParameters: [{ name: 'itemId', segmentIndex: 2 }], parameters: [{ name: 'itemId', in: 'path', required: true, shape: { type: 'string' } }] });
  expect(result.omittedOrigins).toBe(2);
  expect(result.warnings).toEqual(expect.arrayContaining(['unresolved_ref', 'schema_truncated', 'server_variables_unresolved']));
  expect(JSON.stringify(result)).not.toContain('example-private');
  const swagger = discoverOpenApi({ swagger: '2.0', host: 'example.com', schemes: ['https'], basePath: '/v2', paths: { '/list': { get: { responses: { 200: { schema: { type: 'array', items: { type: 'string' } } } } } } } }, 'https://example.com/swagger.json', ['https://example.com']);
  expect(swagger.operations[0]).toMatchObject({ url: 'https://example.com/v2/list', responses: [{ status: 200, shape: { type: 'array', items: { type: 'string' } } }] });
});

it('bounds document discovery, honors Swagger operation schemes and reports malformed servers', () => {
  const paths = Object.fromEntries(Array.from({ length: 201 }, (_, i) => ['/items-' + i, { get: { responses: {} } }]));
  const bounded = discoverOpenApi({ openapi: '3.1.0', paths }, 'https://example.com/spec.json', ['https://example.com']);
  expect(bounded.operations).toHaveLength(200);
  expect(bounded.totalOperations).toBe(201);
  expect(bounded.warnings).toContain('operations_truncated');
  const document = { swagger: '2.0', schemes: 'invalid', paths: { '/list': { get: { schemes: ['https'] }, post: {} } } };
  const result = discoverOpenApi(document, 'https://example.com/spec.json', ['https://example.com']);
  expect(result.operations).toHaveLength(1);
  expect(result.warnings).toContain('invalid_server');
  expect(() => discoverOpenApi({ openapi: '3.2.0', paths: {} }, 'https://example.com/spec.json', ['https://example.com'])).toThrow(/OpenAPI/);
});
