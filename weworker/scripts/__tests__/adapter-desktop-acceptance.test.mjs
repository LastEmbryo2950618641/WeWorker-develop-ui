import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../adapter-desktop-acceptance.mjs', import.meta.url));
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { windowsHide: true });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', reject);
    child.on('exit', code => resolve({ code, output }));
  });
}
test('desktop acceptance rejects missing application before starting services', async () => {
  const result = await run([]);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Supply a Windows packaged application directory/);
});
test('desktop acceptance refuses an occupied Bridge port without stopping its owner', async () => {
  const server = net.createServer();
  const owned = await new Promise(resolve => {
    server.once('error', () => resolve(false));
    server.listen(3711, () => resolve(true));
  });
  try {
    const root = mkdtempSync(join(tmpdir(), 'desktop-preflight-'));
    writeFileSync(join(root, 'WeWorker.exe'), 'fixture: must never execute');
    const result = await run([root]);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Port 3711 is occupied; no process was stopped/);
    if (owned) assert.equal(server.listening, true);
  } finally {
    if (owned) await new Promise(resolve => server.close(resolve));
  }
});
