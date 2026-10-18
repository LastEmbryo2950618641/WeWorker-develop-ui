// Real CLI and host HTTP, isolated catalog, no browser or user Bridge.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile), source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webcli-output-acceptance-'));
const bundled = process.argv.includes('--bundled');
const entry = bundled ? path.resolve(source, '../weworker/build/webcli-dist/webcli.cjs') : path.join(source, 'index.js');
const python = process.argv.find(arg => arg.startsWith('--python='))?.slice(9);
if (!python) throw new Error('Pass --python=<isolated Python with PyYAML> for independent YAML/CSV parsing.');
const value = [{ id: '007', title: '示例,"first"\r\nsecond', active: false, count: 0, detail: { value: 'true' } }, { id: '008', title: 'Next', later: '2026-10-18' }];
const requests = [];
const server = http.createServer((req, res) => { requests.push(req.url); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port, checks = [];
const pass = name => { checks.push(name); console.log('PASS ' + name); };
console.log('Artifacts: ' + root);
try {
  const dir = path.join(root, 'builtin/example-output'); await fs.mkdir(path.join(dir, 'http/commands'), { recursive: true });
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ schema_version: 2, name: 'example-output', version: '1.0.0', description: 'Isolated output fixture',
    commands: [{ id: 'read', runtime: 'http', module: 'http/commands/read.js', description: 'Read public example', safety: 'read', schema: { type: 'object', properties: { format: { type: 'string' }, id: { type: 'string' } } },
      http: { version: 1, strategy: 'PUBLIC_API', origins: [origin] } }] }));
  await fs.writeFile(path.join(dir, 'http/commands/read.js'), `module.exports=(args,api)=>api.request({url:${JSON.stringify(origin)}+'/items?id='+encodeURIComponent(args.id)+'&format='+encodeURIComponent(args.format)});`);
  const env = { ...process.env, WEWORKER_BUILD_PROFILE: 'public', WEWORKER_BUILTIN_ADAPTERS_DIR: path.join(root, 'builtin'), WEWORKER_USER_ADAPTERS_DIR: path.join(root, 'user'), WEBCLI_ADAPTERS_DIR: path.join(root, 'user'), WEWORKER_ADAPTER_DATA_DIR: path.join(root, 'data'), WEBCLI_PROFILE: 'example-offline', WEBCLI_METRICS: 'off', WEBCLI_METRICS_UPLOAD: 'off' };
  delete env.WEWORKER_RESOURCES_PATH;
  for (const format of ['json', 'yaml', 'yml', 'csv', 'table', 'plain', 'markdown', 'md']) {
    const { stdout, stderr } = await exec(process.execPath, [entry, 'call', 'example-output.read', '--id=007', '--format=pdf', '--output-format=' + format], { env });
    assert.equal(stderr, ''); await fs.writeFile(path.join(root, format + '.txt'), stdout);
    if (format === 'json') assert.deepEqual(JSON.parse(stdout).result, value);
    assert.equal(requests.at(-1), '/items?id=007&format=pdf');
  }
  assert.equal(requests.length, 8); pass('eight explicit formats through actual HTTP call; business format and leading-zero ID preserved, one request per call');
  await fs.writeFile(path.join(root, 'expected.json'), JSON.stringify(value));
  const validation = await exec(python, ['-c', `import csv,json,pathlib,sys,yaml
p=pathlib.Path(sys.argv[1]); value=json.loads((p/'expected.json').read_text())
for name in ['yaml','yml']:
 v=yaml.safe_load((p/(name+'.txt')).read_text()); assert v['result'] == value and isinstance(v['trace_id'],str)
with (p/'csv.txt').open(newline='') as f: rows=list(csv.DictReader(f))
assert rows[0]['id']=='007' and rows[0]['title']==value[0]['title']
assert rows[0]['active']=='false' and rows[0]['count']=='0'
assert json.loads(rows[0]['detail'])==value[0]['detail'] and rows[1]['later']=='2026-10-18'
print('independent YAML/CSV parsers passed')`, root]);
  assert.match(validation.stdout, /passed/); pass('independent PyYAML and CSV round trips retain string IDs, quoted Unicode/newlines, booleans, nested values and later columns');
  for (const namespace of ['profile', 'browser', 'exploration']) {
    const json = await exec(process.execPath, [entry, 'call', namespace + '.help'], { env });
    const yaml = await exec(process.execPath, [entry, 'call', namespace + '.help', '--output-format=yaml'], { env });
    const file = path.join(root, namespace + '.yaml'); await fs.writeFile(file, yaml.stdout);
    const parsed = await exec(python, ['-c', 'import json,sys,yaml;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', file]);
    assert.deepEqual(JSON.parse(parsed.stdout), JSON.parse(json.stdout));
  }
  pass('management help keeps default JSON and supports lossless explicit YAML without browser connections');
  for (const args of [['list'], ['adapter', 'list'], ['adapter', 'info', 'example-output'], ['adapter', '--help'], ['adapter', 'example-output', '--help'], ['help'], ['example-output', 'help'], ['example-output', 'read', 'help'], ['--help']]) {
    const json = await exec(process.execPath, [entry, ...args, '--output-format=json'], { env });
    const yaml = await exec(process.execPath, [entry, ...args, '--output-format=yaml'], { env });
    const file = path.join(root, 'catalog-help.yaml'); await fs.writeFile(file, yaml.stdout);
    const parsed = await exec(python, ['-c', 'import json,sys,yaml;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', file]);
    assert.deepEqual(JSON.parse(parsed.stdout), JSON.parse(json.stdout));
  }
  assert.equal(requests.length, 8);
  pass('Adapter list/info, global and progressive help use explicit formats without executing tools');
  for (const args of [['browser.unknown', '--output-format=yaml'], ['browser.console', '--follow', '--output-format=csv'], ['example-output.read', '--output-format=']]) {
    let failure; try { await exec(process.execPath, [entry, 'call', ...args], { env }); } catch (error) { failure = error; }
    assert.equal(failure?.code, 1); assert.ok(!failure.stderr.includes('Bridge not running'));
  }
  assert.equal(requests.length, 8); pass('unknown command, invalid format and incompatible follow fail without requests or Bridge startup');
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ passed: true, bundled, checks }, null, 2));
} catch (error) { await fs.writeFile(path.join(root, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack })); throw error; }
finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
