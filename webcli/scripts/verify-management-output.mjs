// Real AdapterHub CLI against owned loopback catalog and temporary install roots.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile), source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webcli-management-acceptance-'));
const bundled = process.argv.includes('--bundled');
const entry = bundled ? path.resolve(source, '../weworker/build/webcli-dist/webcli.cjs') : path.join(source, 'index.js');
const python = process.argv.find(arg => arg.startsWith('--python='))?.slice(9);
if (!python) throw new Error('Pass --python=<isolated Python with PyYAML>.');
let bytes, metadata, version = '1.0.0';
const requests = [], checks = [], pass = name => { checks.push(name); console.log('PASS ' + name); };
const server = http.createServer((req, res) => {
  requests.push({ method: req.method, url: req.url });
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.endsWith('/download')) { res.end(bytes); return; }
  res.setHeader('content-type', 'application/json');
  const data = url.pathname.endsWith('/versions') ? { items: [{ version, sha256: metadata.sha256 }] }
    : url.pathname.endsWith('/commands') ? { items: [{ id: 'read', runtime: 'http', description: 'Read public items', schema: { type: 'object', properties: {} } }] }
    : url.pathname.endsWith('/example-management') ? { name: 'example-management', version, description: 'Public example', commandCount: 1, artifact: { sha256: metadata.sha256 }, installable: true }
    : { items: [{ name: 'example-management', version, title: '示例,"row"\nnext', count: 0 }], total: 1 };
  res.end(JSON.stringify(data));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const env = { ...process.env, WEBCLI_ADAPTERHUB_ENDPOINT: origin, ADAPTERHUB_TOKEN: '', WEWORKER_BUILD_PROFILE: 'public',
  WEWORKER_BUILTIN_ADAPTERS_DIR: path.join(root, 'builtin'), WEWORKER_USER_ADAPTERS_DIR: path.join(root, 'user'), WEBCLI_ADAPTERS_DIR: path.join(root, 'user'), WEWORKER_ADAPTER_DATA_DIR: path.join(root, 'data'), WEBCLI_METRICS: 'off', WEBCLI_METRICS_UPLOAD: 'off' };
delete env.WEWORKER_RESOURCES_PATH;
const run = async args => (await exec(process.execPath, [entry, 'adapterhub', ...args], { env, maxBuffer: 2 * 1024 * 1024 })).stdout;
const adapter = async args => JSON.parse((await exec(process.execPath, [entry, 'adapter', ...args, '--output-format=json'], { env })).stdout);
console.log('Artifacts: ' + root);
try {
  const directory = path.join(root, 'example-management');
  await fs.mkdir(path.join(directory, 'http/commands'), { recursive: true });
  const manifest = { schema_version: 2, name: 'example-management', version, description: 'Public isolated package', commands: [{ id: 'read', runtime: 'http', module: 'http/commands/read.js', description: 'Read example', safety: 'read', schema: { type: 'object', properties: {} }, http: { version: 1, strategy: 'PUBLIC_API', origins: [origin] } }] };
  await fs.writeFile(path.join(directory, 'http/commands/read.js'), 'module.exports = async () => ({ public: true });');
  const packageFile = path.join(root, 'example.adapt');
  async function pack() {
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ ...manifest, version }));
    metadata = JSON.parse(await run(['pack', directory, '-o', packageFile, '--output-format=json']));
    bytes = await fs.readFile(packageFile);
  }
  await pack();
  assert.equal(JSON.parse(await run(['validate', packageFile, '--output-format=json'])).valid, true);
  for (const args of [['list'], ['find', 'Example'], ['info', 'example-management'], ['versions', 'example-management'], ['commands', 'example-management'], ['installed'], ['list', '--installed'], ['endpoint'], ['help'], ['validate', packageFile]]) {
    const json = JSON.parse(await run([...args, '--output-format=json']));
    const yaml = await run([...args, '--output-format=yaml']);
    const file = path.join(root, 'result.yaml'); await fs.writeFile(file, yaml);
    const parsed = await exec(python, ['-c', 'import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', file]);
    assert.deepEqual(JSON.parse(parsed.stdout), json);
  }
  pass('catalog/details/versions/commands/local inventory/help/offline validation preserve complete JSON and YAML models');
  for (const format of ['json', 'yaml', 'csv', 'table', 'plain', 'markdown']) assert.ok((await run(['list', '--output-format=' + format])).includes('example-management'));
  const downloaded = JSON.parse(await run(['download', 'example-management', '-o', path.join(root, 'downloaded.adapt'), '--output-format=json']));
  assert.deepEqual(await fs.readFile(downloaded.path), bytes);
  pass('six formats and actual package download retain catalog data and validated bytes');
  assert.equal(JSON.parse(await run(['install', 'example-management', '--output-format=json'])).action, 'installed');
  version = '1.0.1'; await pack();
  const preview = JSON.parse(await run(['update', 'example-management', '--dry-run', '--output-format=json']));
  assert.equal(preview.summary.dryRun, true); assert.equal(preview.plan[0].action, 'upgrade');
  assert.equal(JSON.parse(await run(['installed', '--json'])).items[0].version, '1.0.0');
  const updated = JSON.parse(await run(['update', 'example-management', '--output-format=json']));
  assert.equal(updated.summary.updated, 1);
  assert.equal(JSON.parse(await run(['installed', '--json'])).items[0].version, '1.0.1');
  pass('real isolated Hub installation, dry-run and update reuse existing source/permission checks and structured results');
  const status = await adapter(['status', 'example-management']);
  assert.equal(status.items[0].active.source, 'user'); assert.equal(status.items[0].active.version, '1.0.1');
  const validated = await adapter(['validate', '--installed', 'example-management']);
  assert.equal(validated.ok, true); assert.equal(validated.executed, false); assert.equal(validated.summary.commands, 1);
  await fs.writeFile(path.join(directory, 'http/commands/read.js'), 'throw new Error("must not execute"); module.exports = () => [];');
  assert.equal((await adapter(['validate', directory])).ok, true);
  await fs.writeFile(path.join(directory, 'http/commands/read.js'), 'module.exports = ;');
  let syntaxFailure; try { await adapter(['validate', directory]); } catch (error) { syntaxFailure = error; }
  assert.equal(syntaxFailure?.code, 1); assert.equal(JSON.parse(syntaxFailure.stdout).results[0].errors[0].code, 'JAVASCRIPT_SYNTAX');
  assert.equal((await adapter(['validate', '--installed'])).ok, true);
  pass('actual status and static validation report selected digest and syntax failures without executing Adapter modules');
  const count = requests.length;
  for (const args of [['install', 'example-management', '--output-format=invalid'], ['install', '--unknown', '--output-format=json']]) {
    let failure; try { await run(args); } catch (error) { failure = error; }
    assert.equal(failure?.code, 2);
  }
  assert.equal(requests.length, count); assert.ok(requests.every(request => request.method === 'GET'));
  pass('invalid format/options fail before requests; no publication, credential mutation or uninstall');
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ passed: true, bundled, checks, requests }, null, 2));
} catch (error) { await fs.writeFile(path.join(root, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack })); throw error; }
finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
