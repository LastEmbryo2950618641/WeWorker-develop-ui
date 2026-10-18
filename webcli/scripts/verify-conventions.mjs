import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile), source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webcli-conventions-acceptance-'));
const bundled = process.argv.includes('--bundled'), checks = [];
const entry = bundled ? path.resolve(source, '../weworker/build/webcli-dist/webcli.cjs') : path.join(source, 'index.js');
const env = { ...process.env, WEWORKER_BUILD_PROFILE: 'public', WEWORKER_BUILTIN_ADAPTERS_DIR: path.join(root, 'builtin'),
  WEWORKER_USER_ADAPTERS_DIR: path.join(root, 'user'), WEBCLI_ADAPTERS_DIR: path.join(root, 'user'), WEWORKER_ADAPTER_DATA_DIR: path.join(root, 'data') };
delete env.WEWORKER_RESOURCES_PATH;
const directory = path.join(root, 'example-conventions'), file = path.join(directory, 'http/commands/read.js');
const pass = value => { checks.push(value); console.log('PASS ' + value); };
async function run(args, status = 0) {
  let result; try { result = { ...await exec(process.execPath, [entry, 'adapter', ...args], { env }), code: 0 }; }
  catch (error) { result = error; }
  assert.equal(result.code, status, result.stdout + result.stderr); return result.stdout;
}
console.log('Artifacts: ' + root);
try {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const manifest = { schema_version: 2, name: 'example-conventions', version: '1.0.0', description: 'Public convention example', commands: [{ id: 'read', runtime: 'http', module: 'http/commands/read.js', description: 'Read public items', safety: 'read', schema: { type: 'object', properties: {} }, http: { version: 1, strategy: 'PUBLIC_API', origins: ['https://example.com'] } }] };
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  await fs.writeFile(file, 'throw new Error("source must not execute"); module.exports = () => ({ title: "Example" });');
  const good = JSON.parse(await run(['convention-audit', directory]));
  assert.equal(good.ok, true); assert.equal(good.executed, false); assert.equal(good.summary.commands, 1);
  assert.equal(JSON.parse(await run(['validate', directory])).ok, true);
  pass('real CLI audits and compiles a throwing source without running it or contacting a service');
  await fs.writeFile(file, 'throw new Error("must not execute"); module.exports = args => { const limit = Math.min(args.limit, 10); try { return args.value || "unknown"; } catch { return []; } };');
  for (const format of ['json', 'yaml', 'table', 'csv', 'plain', 'markdown']) {
    const output = await run(['convention-audit', directory, '--output-format=' + format], 1);
    assert.ok(output.includes('limit-clamp')); assert.ok(output.includes('empty-error-fallback')); assert.ok(output.includes('placeholder-fallback')); assert.ok(!output.includes(root));
  }
  pass('six formats preserve heuristic findings, relative source locations and failing exit status');
  await fs.writeFile(file, 'module.exports = () => ({ title: "Example" });');
  await run(['install', '--directory', directory]);
  const installed = JSON.parse(await run(['convention-audit', '--installed', 'example-conventions']));
  assert.equal(installed.ok, true); assert.equal(installed.packages[0].source, 'user');
  assert.equal(JSON.parse(await run(['convention-audit', '--installed', 'missing'], 1)).ok, false);
  assert.ok((await run(['convention-audit', '--help', '--output-format=yaml'])).includes('implicit-safety'));
  await fs.writeFile(file, 'module.exports = ;');
  assert.equal(JSON.parse(await run(['convention-audit', directory], 1)).packages[0].errors[0].code, 'JAVASCRIPT_SYNTAX');
  pass('installed selection and unknown/syntax failures retain catalog semantics; no runtime evidence is invented');
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ ok: true, bundled, checks }, null, 2));
} catch (error) { await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ ok: false, bundled, checks, error: error.message }, null, 2)); throw error; }
