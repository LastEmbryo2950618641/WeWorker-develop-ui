// Read-only CLI acceptance against the shipped resources; no user Skill paths.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile), source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundled = process.argv.includes('--bundled');
const entry = bundled ? path.resolve(source, '../weworker/build/webcli-dist/webcli.cjs') : path.join(source, 'index.js');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webcli-skills-acceptance-'));
const env = { ...process.env, WEBCLI_PROFILE: 'example-offline', WEWORKER_ADAPTER_DATA_DIR: path.join(root, 'data'), WEBCLI_METRICS: 'off', WEBCLI_METRICS_UPLOAD: 'off' };
const run = async args => (await exec(process.execPath, [entry, 'skills', ...args], { env, maxBuffer: 2 * 1024 * 1024 })).stdout;
const checks = [], pass = name => { checks.push(name); console.log('PASS ' + name); };
console.log('Artifacts: ' + root);
try {
  const listing = JSON.parse(await run(['list', '--json']));
  assert.deepEqual(listing.map(item => item.name), ['complex-task-planner', 'webcli', 'webcli-api-exploration', 'webcli-browser']);
  for (const item of listing) {
    const expected = await fs.readFile(path.join(source, 'skills', item.path), 'utf8');
    assert.equal(await run(['read', item.name]), expected);
    assert.equal(await run(['read', item.path]), expected);
    assert.deepEqual(JSON.parse(await run(['read', item.name, '--json'])), { skill: item.name, path: 'SKILL.md', content: expected });
  }
  pass('all four bundled Skills list and read byte-for-byte against source, including structured envelopes');
  const references = [];
  async function walk(dir, rel = '') {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const next = rel ? rel + '/' + item.name : item.name;
      if (item.isDirectory()) await walk(path.join(dir, item.name), next);
      else if (item.isFile() && next.includes('/') && item.name !== 'SKILL.md' && /\.(md|txt|json)$/.test(item.name)) references.push(next);
    }
  }
  await walk(path.join(source, 'skills'));
  for (const relative of references) {
    const expected = await fs.readFile(path.join(source, 'skills', relative), 'utf8');
    assert.equal(await run(['read', relative]), expected);
    const [name, ...parts] = relative.split('/');
    assert.equal(await run(['read', name, parts.join('/')]), expected);
  }
  pass(`bundled reference text paths match source (${references.length} resources)`);
  for (const format of ['json', 'yaml', 'csv', 'table', 'plain', 'markdown']) {
    assert.ok((await run(['list', '--output-format=' + format])).length > 0);
    assert.ok((await run(['read', 'webcli', '--output-format=' + format])).includes('webcli'));
  }
  assert.deepEqual(JSON.parse(await run(['help', '--output-format=json'])).commands, ['list', 'read']);
  pass('six formats and help use the real CLI without a Bridge');
  for (const args of [['read', '../example'], ['read', '/example'], ['read', 'webcli/../webcli/SKILL.md'], ['read', 'webcli', '--unknown'], ['list', '--output-format=invalid']]) {
    let failure; try { await run(args); } catch (error) { failure = error; }
    assert.equal(failure?.code, 1); assert.equal(failure.stdout, ''); assert.ok(!failure.stderr.includes('Bridge not running'));
  }
  await assert.rejects(fs.stat(path.join(root, 'data')), { code: 'ENOENT' });
  pass('invalid paths/options fail with zero Bridge or Adapter data creation');
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ passed: true, bundled, checks, references: references.length }, null, 2));
} catch (error) {
  await fs.writeFile(path.join(root, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack })); throw error;
}
