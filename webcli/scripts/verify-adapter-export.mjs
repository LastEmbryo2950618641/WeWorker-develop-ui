// Real source-selection calls, temporary package roots and an owned loopback API.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile), source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webcli-export-acceptance-'));
const bundled = process.argv.includes('--bundled');
const entry = bundled ? path.resolve(source, '../weworker/build/webcli-dist/webcli.cjs') : path.join(source, 'index.js');
const requests = [], checks = [], pass = name => { checks.push(name); console.log('PASS ' + name); };
const server = http.createServer((req, res) => { requests.push(req.url); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ tag: new URL(req.url, 'http://localhost').searchParams.get('tag') })); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const env = { ...process.env, WEWORKER_BUILD_PROFILE: 'public', WEWORKER_BUILTIN_ADAPTERS_DIR: path.join(root, 'builtin'), WEWORKER_USER_ADAPTERS_DIR: path.join(root, 'user'),
  WEBCLI_ADAPTERS_DIR: path.join(root, 'user'), WEWORKER_ADAPTER_DATA_DIR: path.join(root, 'data'), WEBCLI_METRICS: 'off', WEBCLI_METRICS_UPLOAD: 'off' };
delete env.WEWORKER_RESOURCES_PATH;
const run = async args => JSON.parse((await exec(process.execPath, [entry, ...args, '--output-format=json'], { env })).stdout);
console.log('Artifacts: ' + root);
try {
  const builtin = path.join(root, 'builtin/example-export'), destination = path.join(root, 'workspace/example-export');
  await fs.mkdir(path.join(builtin, 'http/commands'), { recursive: true });
  await fs.mkdir(path.dirname(destination)); await fs.mkdir(env.WEWORKER_USER_ADAPTERS_DIR);
  const manifest = { schema_version: 2, name: 'example-export', version: '1.0.0', description: 'Public export fixture',
    commands: [{ id: 'read', runtime: 'http', module: 'http/commands/read.js', description: 'Read public tag', safety: 'read', schema: { type: 'object', properties: {} }, http: { version: 1, strategy: 'PUBLIC_API', origins: [origin] } }] };
  const module = tag => 'module.exports = (args,api) => api.request({url:' + JSON.stringify(origin + '/items?tag=' + tag) + '});';
  await fs.writeFile(path.join(builtin, 'manifest.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(builtin, 'http/commands/read.js'), module('builtin'));
  const initial = await run(['adapter', 'status', 'example-export']);
  const exported = await run(['adapter', 'eject', 'example-export', '--directory', destination]);
  assert.equal(exported.digest, initial.items[0].active.digest); assert.equal(exported.activated, false);
  for (const file of ['manifest.json', 'http/commands/read.js']) assert.deepEqual(await fs.readFile(path.join(destination, file)), await fs.readFile(path.join(builtin, file)));
  assert.equal((await run(['adapter', 'status', 'example-export'])).items[0].active.source, 'builtin');
  assert.equal(requests.length, 0);
  pass('actual CLI exports byte-identical built-in package without executing it or changing selection');
  await fs.writeFile(path.join(destination, 'http/commands/read.js'), module('edited'));
  assert.equal((await run(['adapter', 'validate', destination])).ok, true);
  assert.equal((await run(['call', 'example-export.read'])).tag, 'builtin');
  assert.equal((await run(['adapter', 'develop', destination])).action, 'development-selected');
  assert.equal((await run(['call', 'example-export.read'])).tag, 'edited');
  await run(['adapter', 'use', 'example-export', 'builtin']);
  assert.equal((await run(['call', 'example-export.read'])).tag, 'builtin');
  assert.equal(await fs.readFile(path.join(destination, 'http/commands/read.js'), 'utf8'), module('edited'));
  assert.equal((await run(['adapter', 'status', 'example-export'])).items[0].active.digest, exported.digest);
  pass('edited export activates only via develop; real HTTP follows selection and use builtin preserves the editable copy');
  for (const args of [
    ['adapter', 'eject', 'example-export', '--directory', destination],
    ['adapter', 'eject', 'example-export', '--directory', path.join(env.WEWORKER_USER_ADAPTERS_DIR, 'example-export')],
    ['adapter', 'eject', 'example-export', '--directory', path.join(root, 'workspace/wrong')],
    ['adapter', 'eject', 'example-export', '--directory', path.join(root, 'fresh/example-export'), '--output-format=invalid'],
  ]) {
    let failure;
    try { await exec(process.execPath, [entry, ...args], { env }); } catch (error) { failure = error; }
    assert.equal(failure?.code, 1);
  }
  assert.equal(requests.length, 3);
  assert.deepEqual(requests, ['/items?tag=builtin', '/items?tag=edited', '/items?tag=builtin']);
  assert.equal(await fs.readFile(path.join(builtin, 'http/commands/read.js'), 'utf8'), module('builtin'));
  pass('existing/managed/misnamed destinations and invalid format fail before effects; original and edited bytes remain intact');
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ passed: true, bundled, checks, requests }, null, 2));
} catch (error) { await fs.writeFile(path.join(root, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack })); throw error; }
finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
