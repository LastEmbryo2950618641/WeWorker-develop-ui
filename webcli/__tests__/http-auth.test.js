import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runHttpTool } from '../http-runner.js';
import { readPackageDirectory } from '../adapter-package-files.js';
import { validateHttpContract } from '../http-contract.js';
import { installAdapter } from '../adapter-install-store.js';
import { resolveAdapterPaths } from '../paths.js';
import { verifyHttpDraft } from '../http-preview.js';
import { buildHttpTool } from '../exploration-http.js';

const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.unstubAllEnvs(); });
const envName = 'EXAMPLE_HTTP_CREDENTIAL';
const placeholder = 'example-placeholder-credential';
const hmac = { type: 'hmac', env: envName, header: 'x-example-signature', algorithm: 'sha256', encoding: 'hex', prefix: 'Example ',
  timestamp: { header: 'x-example-time', unit: 'seconds' }, nonce: { header: 'x-example-nonce' }, separator: '\n',
  canonical: ['method', 'origin', 'pathQuery', 'bodySha256', 'timestamp', 'nonce'].map(field => ({ field })) };

async function server() {
  const requests = [];
  let redirect;
  const listener = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, method: req.method, headers: req.headers, body });
    if (req.url === '/redirect' && redirect) { res.writeHead(302, { location: redirect }); res.end(); return; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ headers: req.headers, id: '007', body }));
  });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); }));
  return { origin: `http://127.0.0.1:${listener.address().port}`, requests, redirect: target => { redirect = target; } };
}
async function fixture(auth = { type: 'bearer', env: envName }, source = `module.exports = (args, api) => api.request({url: ORIGIN + '/items'});`, overrides = {}) {
  const endpoint = await server();
  const root = mkdtempSync(join(tmpdir(), 'http-auth-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'builtin/example-auth'); mkdirSync(join(dir, 'http/commands'), { recursive: true });
  const manifest = { schema_version: 2, name: 'example-auth', version: '1.0.0', description: 'Example host authentication',
    commands: [{ id: 'read', runtime: 'http', module: 'http/commands/read.js', description: 'Read example', safety: 'read', schema: {},
      http: { version: 2, strategy: 'AUTH_API', origins: [endpoint.origin], auth: { ...auth, origin: endpoint.origin }, ...overrides } }] };
  const env = { ...process.env, WEWORKER_BUILD_PROFILE: 'public', WEWORKER_BUILTIN_ADAPTERS_DIR: join(root, 'builtin'),
    WEWORKER_USER_ADAPTERS_DIR: join(root, 'user'), WEBCLI_ADAPTERS_DIR: join(root, 'user'), WEWORKER_ADAPTER_DATA_DIR: join(root, 'data'), WEBCLI_PROFILE: 'example-offline' };
  const save = () => {
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const pkg = readPackageDirectory(dir);
    return { adapter: { root: dir, digest: pkg.digest }, command: pkg.commands[0] };
  };
  writeFileSync(join(dir, 'http/commands/read.js'), source.replaceAll('ORIGIN', JSON.stringify(endpoint.origin)));
  return { ...endpoint, root, dir, manifest, env, save, match: save() };
}

it.each([
  [{ type: 'bearer', env: envName }, 'authorization', 'Bearer ' + placeholder],
  [{ type: 'header', env: envName, header: 'x-api-key' }, 'x-api-key', placeholder],
  [{ type: 'basic', usernameEnv: 'EXAMPLE_HTTP_USER', passwordEnv: envName }, 'authorization', 'Basic ' + Buffer.from('example-user:' + placeholder).toString('base64')],
])('runs %j in source or bundled CLI without a browser, redacting credential echoes', async (auth, header, expected) => {
  vi.stubEnv(envName, placeholder); vi.stubEnv('EXAMPLE_HTTP_USER', 'example-user');
  const f = await fixture(auth);
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [process.env.WEBCLI_HTTP_CLI_ENTRY || 'index.js', 'call', 'example-auth.read', '--format=json'],
    { cwd: join(import.meta.dirname, '..'), env: f.env });
  expect(f.requests).toHaveLength(1); expect(f.requests[0].headers[header]).toBe(expected);
  expect(JSON.parse(stdout).headers[header]).toContain('[REDACTED]');
  expect(stdout + stderr).not.toContain(placeholder); expect(stdout + stderr).not.toContain(expected);
});

it.each([undefined, '', 'example\r\ncredential'])('fails before any request when the declared host credential is missing or invalid', async value => {
  vi.stubEnv(envName, value);
  const f = await fixture();
  await expect(runHttpTool(f.match)).rejects.toMatchObject({ code: value ? 'HTTP_CREDENTIALS_INVALID' : 'HTTP_CREDENTIALS_MISSING' });
  expect(f.requests).toHaveLength(0);
});

it.each([
  { type: 'bearer', env: envName }, { type: 'header', env: envName, header: 'x-api-key' },
  { type: 'basic', usernameEnv: 'EXAMPLE_HTTP_USER', passwordEnv: envName }, hmac,
])('does not forward %j credentials to another declared origin, including redirect bodies', async auth => {
  vi.stubEnv(envName, placeholder); vi.stubEnv('EXAMPLE_HTTP_USER', 'example-user');
  const target = await server();
  const f = await fixture(auth, `module.exports = (args, api) => api.request({url: ORIGIN + '/redirect', method:'POST', json:{id:'example'}});`);
  f.manifest.commands[0].http.origins.push(target.origin); f.match = f.save(); f.redirect(target.origin + '/items');
  await runHttpTool(f.match);
  expect(f.requests).toHaveLength(1); expect(target.requests).toHaveLength(1);
  expect(f.requests[0].headers[auth.header || 'authorization']).toBeTruthy();
  expect(target.requests[0]).toMatchObject({ method: 'GET', body: '' });
  for (const header of ['authorization', 'x-api-key', 'x-example-signature', 'x-example-time', 'x-example-nonce', 'cookie']) expect(target.requests[0].headers[header]).toBeUndefined();
});

it.each([['sha256', 'hex'], ['sha512', 'base64']])('signs actual method, URL and bytes with %s/%s and regenerates redirect signatures', async (algorithm, encoding) => {
  vi.stubEnv(envName, placeholder);
  const f = await fixture({ ...hmac, algorithm, encoding }, `module.exports = (args, api) => api.request({url: ORIGIN + '/redirect', method:'POST', json:{id:'007', text:'示例'}});`);
  f.redirect(f.origin + '/items?q=008');
  const output = await runHttpTool(f.match);
  expect(f.requests).toHaveLength(2);
  for (const req of f.requests) {
    const digest = createHash('sha256').update(req.body).digest('hex');
    const canonical = [req.method, f.origin, req.url, digest, req.headers['x-example-time'], req.headers['x-example-nonce']].join('\n');
    const signature = createHmac(algorithm, placeholder).update(canonical).digest(encoding);
    expect(req.headers['x-example-signature']).toBe('Example ' + signature);
    expect(Math.abs(Date.now() / 1000 - Number(req.headers['x-example-time']))).toBeLessThan(10);
    expect(JSON.stringify(output)).not.toContain(signature);
  }
  expect(f.requests[0].headers['x-example-nonce']).not.toBe(f.requests[1].headers['x-example-nonce']);
  expect(f.requests[0].headers['x-example-signature']).not.toBe(f.requests[1].headers['x-example-signature']);
});

it('signs declared normalized headers/literals, and rejects missing signing inputs', async () => {
  vi.stubEnv(envName, placeholder);
  const auth = { ...hmac, canonical: [{ literal: 'example' }, { header: 'x-request-kind' }, { header: 'content-type' }, { field: 'bodySha256' }] };
  const f = await fixture(auth, `module.exports = (args, api) => api.request({url:ORIGIN + '/items', method:'POST', json:{id:'007'}, headers:args.headers});`);
  await expect(runHttpTool(f.match, {})).rejects.toMatchObject({ code: 'HTTP_SIGNING_INPUT_MISSING' });
  expect(f.requests).toHaveLength(0);
  await runHttpTool(f.match, { headers: { 'x-request-kind': '  example-read  ' } });
  const canonical = 'example\nexample-read\napplication/json\n' + createHash('sha256').update('{"id":"007"}').digest('hex');
  expect(f.requests[0].headers['x-example-signature']).toBe('Example ' + createHmac('sha256', placeholder).update(canonical).digest('hex'));
});

it('prevents command overrides of authentication, timestamp and nonce headers', async () => {
  vi.stubEnv(envName, placeholder);
  const f = await fixture(hmac, `module.exports = (args, api) => api.request({url: ORIGIN + '/items', headers:args.headers});`);
  for (const name of ['X-Example-Signature', 'X-Example-Time', 'x-example-nonce']) {
    await expect(runHttpTool(f.match, { headers: { [name]: 'example-authored' } })).rejects.toMatchObject({ code: 'HTTP_INVALID_HEADERS' });
  }
  expect(f.requests).toHaveLength(0);
});

it('combines host authentication with exact cookie store/partition scope, including preview capability gates', async () => {
  vi.stubEnv(envName, placeholder);
  const f = await fixture();
  const partitionKey = { topLevelSite: 'https://example.org', hasCrossSiteAncestor: true };
  f.manifest.commands[0].http.strategy = 'COOKIE_API';
  f.manifest.commands[0].http.cookies = { origin: f.origin, names: ['example_session'], storeId: '0', partitionKey };
  f.match = f.save();
  const resolveCookies = vi.fn(async () => [{ name: 'example_session', value: 'example-cookie-placeholder' }]);
  const output = await runHttpTool(f.match, {}, { resolveCookies });
  expect(resolveCookies).toHaveBeenCalledWith({ version: 2, url: f.origin + '/items', names: ['example_session'], storeId: '0', partitionKey });
  expect(f.requests[0].headers.authorization).toBe('Bearer ' + placeholder);
  expect(output.result.headers.cookie).toBe('example_session=[REDACTED]');
  const pkg = readPackageDirectory(f.dir), requestExtension = vi.fn(async () => ({ cookies: await resolveCookies() }));
  const preview = { pkg, adapterDir: f.dir, commands: pkg.commands, verification: { 'example-auth.read': [{ id: 'example', args: {}, expect: { equals: { id: '007' } } }] }, requestExtension, capabilities: () => [] };
  expect((await verifyHttpDraft(preview)).passed).toBe(false);
  expect(requestExtension).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(1);
  expect((await verifyHttpDraft({ ...preview, capabilities: () => ['http_credentials_v2'] })).passed).toBe(true);
  expect(f.requests).toHaveLength(2);
});

it('redacts header normalization and rejects whitespace-only credentials', async () => {
  vi.stubEnv(envName, '  example-placeholder-credential  ');
  const f = await fixture({ type: 'header', env: envName, header: 'x-api-key' });
  expect((await runHttpTool(f.match)).result.headers['x-api-key']).toBe('[REDACTED]');
  expect(f.requests[0].headers['x-api-key']).toBe(placeholder);
  vi.stubEnv(envName, '   ');
  await expect(runHttpTool(f.match)).rejects.toMatchObject({ code: 'HTTP_CREDENTIALS_INVALID' });
  expect(f.requests).toHaveLength(1);
});

it('requires installation permission upgrades for every auth or cookie scope change', async () => {
  vi.stubEnv(envName, placeholder);
  const f = await fixture(hmac);
  const paths = resolveAdapterPaths({ home: f.root, env: f.env });
  const pkg = readPackageDirectory(f.dir);
  installAdapter({ files: pkg.files, origin: { kind: 'local' } }, { paths });
  for (const change of [spec => { spec.auth.env = 'EXAMPLE_OTHER_KEY'; }, spec => { spec.auth.header = 'x-other-auth'; },
    spec => { spec.auth.canonical = [{ field: 'pathQuery' }]; }, spec => { spec.origins.push('https://example.org'); spec.auth.origin = 'https://example.org'; },
    spec => { spec.strategy = 'COOKIE_API'; spec.cookies = { origin: f.origin, names: ['example_session'], storeId: '0', partitionKey: { topLevelSite: 'https://example.org', hasCrossSiteAncestor: true } }; }]) {
    const next = structuredClone(f.manifest); next.version = '1.1.0'; change(next.commands[0].http);
    const files = new Map(pkg.files); files.set('manifest.json', JSON.stringify(next));
    expect(() => installAdapter({ files, origin: { kind: 'local' } }, { paths })).toThrow(/permission/i);
    expect(() => installAdapter({ files, origin: { kind: 'local' }, allowPermissionChange: true }, { paths })).not.toThrow();
    // Reinstall the original contract explicitly for the next independent change.
    installAdapter({ files: pkg.files, origin: { kind: 'local' }, allowPermissionChange: true, allowDowngrade: true }, { paths });
  }
});

it('rejects unknown v2 fields, invalid scopes and ambiguous auth contracts', () => {
  const spec = { version: 2, strategy: 'AUTH_API', origins: ['https://example.com'], auth: { ...hmac, origin: 'https://example.com' } };
  validateHttpContract({ runtime: 'http', http: spec });
  for (const change of [s => { s.version = 1; }, s => { s.strategy = 'PUBLIC_API'; }, s => { s.auth.env = 'example-key-value!'; },
    s => { s.auth.value = 'example-placeholder'; }, s => { s.auth.origin = 'https://example.org'; }, s => { s.auth.header = 'Host'; },
    s => { s.auth.timestamp.header = s.auth.header; }, s => { s.auth.timestamp.unit = 'minutes'; }, s => { s.auth.algorithm = 'md5'; },
    s => { s.auth.encoding = 'utf8'; }, s => { s.auth.canonical = [{ field: 'unknown' }]; }, s => { s.auth.canonical = [{ header: 'cookie' }]; },
    s => { s.auth.prefix = 'example\n'; }, s => { s.auth.canonical = [{ field: 'method', literal: 'ambiguous' }]; },
    s => { s.strategy = 'COOKIE_API'; s.cookies = { origin: s.origins[0], names: ['example_session'], partitionKey: { topLevelSite: 'https://example.org' } }; },
    s => { s.strategy = 'COOKIE_API'; s.cookies = { origin: s.origins[0], names: ['example_session'], storeId: '' }; },
    s => { s.strategy = 'COOKIE_API'; s.cookies = { origin: s.origins[0], names: ['example_session'], csrf: { cookie: 'example_session', header: 'x-example-signature' } }; }]) {
    const invalid = structuredClone(spec); change(invalid);
    expect(() => validateHttpContract({ runtime: 'http', http: invalid })).toThrow();
  }
});

it('scaffolds AUTH_API and partitioned COOKIE_API as v2 while leaving v1 public plans unchanged', () => {
  const candidate = { url: 'https://example.com/api/items', method: 'GET' };
  const tool = { name: 'items', sourceApiIndexes: [0], strategy: 'AUTH_API', auth: { type: 'bearer', env: envName, origin: 'https://example.com' } };
  expect(buildHttpTool('example.com', tool, candidate).toolDefinition.http).toEqual({ version: 2, strategy: 'AUTH_API', origins: ['https://example.com'], auth: tool.auth });
  const cookies = { origin: 'https://example.com', names: ['example_session'], storeId: '0' };
  expect(buildHttpTool('example.com', { ...tool, strategy: 'COOKIE_API', auth: undefined, cookies }, candidate).toolDefinition.http).toMatchObject({ version: 2, cookies });
  expect(buildHttpTool('example.com', { ...tool, strategy: 'PUBLIC_API', auth: undefined }, candidate).toolDefinition.http.version).toBe(1);
});
