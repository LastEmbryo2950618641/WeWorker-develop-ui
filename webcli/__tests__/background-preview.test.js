import { expect, it, vi, afterEach } from 'vitest';
import { validateBackgroundPreview, backgroundPreviewRequest } from '../../extension/background/generation-background-preview.js';
import { handleBackendRuntimeFetch } from '../bridge.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const command = { id: 'list', runtime: 'extension', safety: 'read', execution: { type: 'api', runtime: 'background' } };
const bundle = { manifest: { schema_version: 2, name: 'example.com', commands: [command] } };
const testCase = { toolName: 'example.com.list', caseId: 'example-first', execute: true, arguments: {}, risk: { level: 'read', confidence: .95 }, contract: { kind: 'json' } };
const validate = (testCases, execute = async () => ({ title: 'Example' }), selected = bundle) => validateBackgroundPreview({ bundle: selected, expectedToolNames: ['example.com.list'], testCases, execute });

it('runs a real background case and reports the execution context', async () => {
  const execute = vi.fn(async () => ({ title: 'Example' }));
  const result = await validate([testCase], execute);
  expect(result).toMatchObject({ passed: true, executionMode: 'background', pageContextUsed: false, executionSummary: { attempted: 1, passed: 1, failed: 0 } });
  expect(execute).toHaveBeenCalledWith(bundle.manifest, command, {}, bundle);
  expect(JSON.stringify(result)).not.toContain('"title":"Example"');
});
it.each([{ captureBound: true }, { caseId: '' }, { execute: false }, { risk: { level: 'read' } }, { risk: { level: 'write', confidence: 1 } }, { validationErrors: [{}] }])('does not dispatch unverified inputs %j', async changes => {
  const execute = vi.fn(); expect((await validate([{ ...testCase, ...changes }], execute)).passed).toBe(false); expect(execute).not.toHaveBeenCalled();
});
it('rejects page metadata, empty cases, continuations and private runtime errors', async () => {
  expect((await validate([])).passed).toBe(false);
  await expect(validate([testCase], undefined, { manifest: { ...bundle.manifest, commands: [{ ...command, pageRoute: {} }] } })).rejects.toThrow(/background/);
  expect((await validate([testCase], async () => ({ __webcli_page_query: {} }))).passed).toBe(false);
  const failure = await validate([testCase], async () => { throw Error('example-private-marker'); });
  expect(failure.passed).toBe(false); expect(JSON.stringify(failure)).not.toContain('example-private-marker');
});
it('forces helper calls to avoid pages, caches and authentication fallback', () => {
  expect(backgroundPreviewRequest('cookies_get', { browserDebugger: true })).toEqual({ browserDebugger: false });
  expect(backgroundPreviewRequest('storage_get', { url: 'https://example.com' }).cacheOnly).toBe(true);
  expect(backgroundPreviewRequest('storage_get', { cacheOnly: true }).cacheOnly).toBe(true);
  expect(backgroundPreviewRequest('backend_fetch', { browserFallback: true })).toMatchObject({ backgroundPreviewRead: true, browserFallback: false, redactBodyInTrace: true });
  for (const action of ['navigate', 'browser_fetch', 'main_world_eval', 'backend_file_write']) expect(() => backgroundPreviewRequest(action, {})).toThrow();
});
it.each([{ cacheOnly: false }, { forceRefresh: true }, { cacheOnly: true, forceRefresh: true }])('does not silently validate a preparation request as a cached read %j', async payload => {
  const request = vi.fn();
  const result = await validate([testCase], async () => request(backgroundPreviewRequest('storage_get', payload)));
  expect(result.errors[0].code).toBe('BACKGROUND_PREPARATION_REQUIRES_PAGE');
  expect(result.passed).toBe(false);
  expect(request).not.toHaveBeenCalled();
});
it.each(['LOGIN_REQUIRED', 'PAGE_CONTEXT_REQUIRED', 'INVALID_ARGS', 'HTTP_ERROR', 'API_ERROR',
  'INVALID_RESPONSE', 'BACKEND_HELPER_ERROR', 'MISSING_PERMISSION', 'RUNTIME_UNAVAILABLE',
  'ADAPTER_COMMAND_UNAVAILABLE', 'BACKGROUND_PREPARATION_REQUIRES_PAGE'])('reports the public category %s without exception content', async code => {
  const result = await validate([testCase], async () => {
    throw Object.assign(Error('example-private-message'), { code, details: { token: 'example-private-token' } });
  });
  expect(result.errors[0]).toMatchObject({ code, caseId: 'example-first' });
  expect(result.executionSummary).toMatchObject({ passed: 0, failed: 1 });
  expect(JSON.stringify(result)).not.toContain('example-private');
});
it.each(['example-private-code', 'LOGIN_REQUIRED example-private-code', '', undefined])('redacts non-allowlisted exception codes %s', async code => {
  const result = await validate([testCase], async () => { throw Object.assign(Error('example-private-message'), { code }); });
  expect(result.errors[0].code).toBe('BACKGROUND_PREVIEW_FAILED');
  expect(JSON.stringify(result)).not.toContain('example-private');
});
it.each([
  { url: 'https://example.com/api/delete' },
  { url: 'https://example.com/api/list?action=remove' },
  { url: 'https://example.com/api/list?token=example-placeholder' },
  { url: 'https://example.com/api/list', method: 'DELETE' },
  { url: 'https://example.com/api/list', headers: { 'x-http-method-override': 'DELETE' } },
  { url: 'https://example.com/graphql', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":"mutation Delete { remove(id:1) }"}' },
])('rejects mutation or credential selectors before transport %j', async options => {
  vi.stubGlobal('fetch', vi.fn());
  await expect(handleBackendRuntimeFetch({ ...options, backgroundPreviewRead: true })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it('allows JSON read POST, bounds transport and omits traces without changing ordinary fetch', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"items":[]}', { status: 200 })));
  const trace = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const result = await handleBackendRuntimeFetch({ url: 'https://example.com/api/search', backgroundPreviewRead: true,
    options: { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'example_session=example-placeholder' }, body: '{"keyword":"Example"}' } }, 'example-trace');
  expect(result).toMatchObject({ ok: true, body: '{"items":[]}' });
  expect(fetch).toHaveBeenCalledWith('https://example.com/api/search', expect.objectContaining({ method: 'POST', redirect: 'manual' }));
  expect(trace).not.toHaveBeenCalled();
});
it('rejects redirects and does not replay a failed transport', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 302, headers: { location: 'https://example.com/api/delete' } })));
  await expect(handleBackendRuntimeFetch({ url: 'https://example.com/api/list', backgroundPreviewRead: true })).rejects.toThrow(/redirects/);
  expect(fetch).toHaveBeenCalledOnce();
  fetch.mockReset().mockRejectedValue(Error('example-private-marker'));
  await expect(handleBackendRuntimeFetch({ url: 'https://example.com/api/list', backgroundPreviewRead: true })).rejects.toThrow('Background preview request failed; no retry was sent.');
  expect(fetch).toHaveBeenCalledOnce();
});
