import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function verifyHostHttp({ browser, launchSecond, cliEntry, env, root, passed, record }) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end(`<title>Example HTTP API</title><h1>Example API</h1><script>fetch('/api/list?q=example').then(r=>r.json()).then(x=>document.body.dataset.ready='yes')</script>`); return; }
    const profile = req.headers.cookie?.includes('example-profile-a') ? 'a' : req.headers.cookie?.includes('example-profile-b') ? 'b' : null;
    const authenticated = req.headers.authorization === 'Bearer example-host-auth-placeholder';
    const partition = req.headers.cookie === 'example_partition=example-partition-chosen' ? 'chosen' : null;
    requests.push({ path: url.pathname, profile, csrf: req.headers['x-csrf-token'] === 'example-csrf', authenticated, partition });
    if (url.pathname === '/api/private' && (!profile || req.headers['x-csrf-token'] !== 'example-csrf')) { res.writeHead(403); res.end('{}'); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ items: [{ id: url.searchParams.get('q'), title: 'Example item' }], profile, authenticated, partition }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let second, page;
  async function call(command, args = {}, profile, expectOk = true) {
    let out;
    try { out = await exec(process.execPath, [cliEntry, 'call', command, '--args', JSON.stringify(args), '--output-format=json', ...(profile ? ['--profile=' + profile] : [])], { env, timeout: 45000 }); }
    catch (error) { if (expectOk) throw error; out = error; }
    return JSON.parse(out.stdout);
  }
  const profiles = async () => (await call('profile.list')).data.profiles.filter(item => item.online);
  try {
    const first = (await profiles())[0].contextId;
    await browser.addCookies([
      { name: 'example_session', value: 'example-profile-a', url: origin, httpOnly: true },
      { name: 'example_csrf', value: 'example-csrf', url: origin },
    ]);
    page = await browser.newPage(); await page.goto(origin);
    const tabId = (await call('browser.tabs', {}, first)).data.tabs.find(tab => tab.url === origin + '/').id;
    const started = await call('exploration.start', { tabId, goal: 'Read public example API', requestId: 'example-http-real' }, first);
    assert.equal(started.ok, true); const taskId = started.data.taskId;
    const waitTask = async state => {
      for (let i = 0; i < 80; i++) {
        const output = await call('exploration.get', { taskId }, first);
        if (output.data.status === state) return output;
        assert.notEqual(output.data.status, 'failed', JSON.stringify(output)); await delay(100);
      }
      throw new Error('HTTP exploration did not reach ' + state);
    };
    await waitTask('evidence_ready');
    const evidence = await call('exploration.evidence', { taskId }, first);
    const sourceApiIndex = evidence.data.candidates.findIndex(item => new URL(item.url).pathname === '/api/list');
    assert.ok(sourceApiIndex >= 0);
    const generated = await call('exploration.generate', { taskId, plan: { tools: [{ name: 'public_http', risk: 'read', sourceApiKind: 'list', sourceApiIndexes: [sourceApiIndex],
      strategy: 'PUBLIC_API', readReason: 'Read-only public GET endpoint', strategyNote: { reason: 'Example public API', limitations: 'Validated without credentials' } },
      { name: 'auth_http', risk: 'read', sourceApiKind: 'list', sourceApiIndexes: [sourceApiIndex], strategy: 'AUTH_API',
        auth: { type: 'bearer', origin, env: 'EXAMPLE_HTTP_ACCEPTANCE_KEY' }, readReason: 'Read-only GET endpoint',
        strategyNote: { reason: 'Example scoped environment credential', limitations: 'Requires executing host environment' } }] } }, first);
    assert.equal(generated.ok, true);
    const tool = generated.data.adapter + '.public-http';
    const before = await call('exploration.verification-read', { taskId, tool }, first);
    assert.equal((await call('exploration.verification-write', { taskId, tool, expectedHash: before.data.hash, cases: ['007', '008'].map(id => ({ id: 'example-' + id, args: { q: id }, expect: { equals: { 'items.0.id': id, profile: null } } })) }, first)).ok, true);
    const authTool = generated.data.adapter + '.auth-http';
    const authBefore = await call('exploration.verification-read', { taskId, tool: authTool }, first);
    assert.equal((await call('exploration.verification-write', { taskId, tool: authTool, expectedHash: authBefore.data.hash,
      cases: [{ id: 'example-auth', args: { q: '007' }, expect: { equals: { 'items.0.id': '007', authenticated: true, profile: null } } }] }, first)).ok, true);
    assert.equal((await call('exploration.validate', { taskId }, first)).ok, true); await waitTask('review_ready');
    const review = await call('exploration.review', { taskId }, first);
    assert.equal((await call('exploration.install', { taskId, reviewId: review.data.reviewId, confirmed: true }, first)).ok, true); await waitTask('installed');
    await page.close(); page = null;
    assert.equal((await call(tool, { q: '009' }, 'example-offline')).items[0].id, '009');
    passed('PUBLIC_API real capture → host preview cases → install → browser-independent ordinary call');
    assert.equal((await call(authTool, { q: '009' }, 'example-offline')).authenticated, true);
    passed('AUTH_API real generation → Bridge environment preview → installation → offline-profile CLI call');

    const packageDir = path.join(root, 'http-fixture', 'example-http-cookie');
    await fs.mkdir(path.join(packageDir, 'http/commands'), { recursive: true });
    const manifest = { schema_version: 2, name: 'example-http-cookie', version: '1.0.0', description: 'Example cookie HTTP acceptance', commands: [
      { id: 'read', runtime: 'http', module: 'http/commands/read.js', description: 'Read example private API', safety: 'read', schema: {},
        http: { version: 1, strategy: 'COOKIE_API', origins: [origin], cookies: { origin, names: ['example_session', 'example_csrf'], csrf: { cookie: 'example_csrf', header: 'x-csrf-token' } } } },
    ] };
    await fs.writeFile(path.join(packageDir, 'manifest.json'), JSON.stringify(manifest));
    await fs.writeFile(path.join(packageDir, 'http/commands/read.js'), `module.exports = (args, api) => api.request({url:${JSON.stringify(origin + '/api/private?q=example')}});`);
    await exec(process.execPath, [cliEntry, 'adapter', 'install', '--directory', packageDir, '--json'], { env, timeout: 20000 });
    second = await launchSecond();
    await second.addCookies([{ name: 'example_session', value: 'example-profile-b', url: origin, httpOnly: true }, { name: 'example_csrf', value: 'example-csrf', url: origin }]);
    let secondId;
    for (let i = 0; i < 40; i++) { secondId = (await profiles()).find(item => item.contextId !== first)?.contextId; if (secondId) break; await delay(250); }
    assert.ok(secondId);
    const [a, b] = await Promise.all([call('example-http-cookie.read', {}, first), call('example-http-cookie.read', {}, secondId)]);
    assert.equal(a.profile, 'a'); assert.equal(b.profile, 'b');
    assert.equal((await call(tool, { q: '010' })).profile, null);
    passed('COOKIE_API real HttpOnly/CSRF from two browser profiles remain isolated; PUBLIC_API ignores ambiguity');
    const extensionWorker = browser.serviceWorkers().find(worker => worker.url().startsWith('chrome-extension://'));
    assert.ok(extensionWorker);
    // Chrome permits ancestor=false only for the cookie's own schemeful site.
    const partitionKey = { topLevelSite: 'http://127.0.0.1', hasCrossSiteAncestor: true };
    const storeId = await extensionWorker.evaluate(async ({ origin, partitionKey }) => {
      const base = { url: origin, name: 'example_partition', secure: true, sameSite: 'no_restriction' };
      const selected = await chrome.cookies.set({ ...base, value: 'example-partition-chosen', partitionKey });
      await chrome.cookies.set({ ...base, value: 'example-partition-default' });
      await chrome.cookies.set({ ...base, value: 'example-partition-other', partitionKey: { ...partitionKey, topLevelSite: 'https://example.com' } });
      await chrome.cookies.set({ ...base, value: 'example-partition-ancestor', partitionKey: { ...partitionKey, hasCrossSiteAncestor: false } });
      if (selected.partitionKey.topLevelSite !== partitionKey.topLevelSite || selected.partitionKey.hasCrossSiteAncestor !== true) throw new Error('Browser did not preserve the requested partition.');
      return selected.storeId;
    }, { origin, partitionKey });
    const scopedDir = path.join(root, 'http-fixture/example-http-scoped');
    await fs.mkdir(path.join(scopedDir, 'http/commands'), { recursive: true });
    const scoped = { ...manifest, name: 'example-http-scoped', commands: [{ ...manifest.commands[0],
      http: { version: 2, strategy: 'COOKIE_API', origins: [origin], cookies: { origin, names: ['example_partition'], storeId, partitionKey } } }] };
    await fs.writeFile(path.join(scopedDir, 'manifest.json'), JSON.stringify(scoped));
    await fs.writeFile(path.join(scopedDir, 'http/commands/read.js'), `module.exports = (args, api) => api.request({url:${JSON.stringify(origin + '/api/partition?q=example')}});`);
    await exec(process.execPath, [cliEntry, 'adapter', 'install', '--directory', scopedDir, '--json'], { env, timeout: 20000 });
    assert.equal((await call('example-http-scoped.read', {}, first)).partition, 'chosen');
    const partitionCount = requests.length;
    assert.equal((await call('example-http-scoped.read', {}, secondId, false)).code, 'HTTP_CREDENTIALS_MISSING');
    assert.equal(requests.length, partitionCount);
    passed('COOKIE_API v2 real store/partition/ancestor selection excludes same-name default and other partitions');
    await second.clearCookies();
    const count = requests.length;
    assert.equal((await call('example-http-cookie.read', {}, secondId, false)).code, 'HTTP_CREDENTIALS_MISSING');
    assert.equal(requests.length, count);
    assert.equal((await call('example-http-cookie.read', {}, first)).profile, 'a');
    passed('Missing cookies fail before HTTP without falling back to another profile');
    const noCredentials = async target => {
      const stat = await fs.stat(target).catch(() => null); if (!stat) return;
      if (stat.isDirectory()) { for (const name of await fs.readdir(target)) await noCredentials(path.join(target, name)); }
      else assert.doesNotMatch(await fs.readFile(target, 'utf8'), /example-profile-[ab]|example-csrf|example-partition-(?:chosen|default|other|ancestor)|example-host-auth-placeholder/, 'Raw fixture credentials must not persist in logs or Adapter/task stores.');
    };
    for (const target of [path.join(root, 'bridge.log'), env.WEWORKER_ADAPTER_DATA_DIR, env.WEWORKER_USER_ADAPTERS_DIR]) await noCredentials(target);
    passed('HTTP credential values absent from Bridge logs and persisted Adapter/task stores');
    await record('host-http', { requests, publicTool: tool, rawCredentialsAbsentFromStores: true });
  } finally {
    await page?.close().catch(() => {}); await second?.close().catch(() => {});
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}
