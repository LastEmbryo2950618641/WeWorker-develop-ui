/** Opt-in acceptance against a real embedded Runtime, never the user's state.
 * WEWORKER_TEST_CLI points to a source index.js or packaged webcli.cjs.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

test('managed Toolkit package uses the real embedded Runtime', {
  skip: !process.env.WEWORKER_TEST_CLI, timeout: 90000,
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'weworker-toolkit-acceptance-'));
  const pkg = join(root, 'toolkit-fixture');
  mkdirSync(join(pkg, 'wewright/commands'), { recursive: true });
  const env = {
    ...process.env, HOME: root, USERPROFILE: root,
    WEWORKER_USER_ADAPTERS_DIR: join(root, 'adapters'), WEBCLI_ADAPTERS_DIR: join(root, 'adapters'),
    WEWORKER_ADAPTER_DATA_DIR: join(root, 'data'), WEWORKER_ADAPTERS_DIR: join(root, 'legacy'),
    WEBWRIGHT_HOME: join(root, '.weworker/webwright'), WEBCLI_METRICS_UPLOAD: 'off',
  };
  delete env.WEWORKER_RESOURCES_PATH;
  delete env.WEWORKER_BUILTIN_ADAPTERS_DIR;
  delete env.WEWORKER_BUILD_PROFILE;
  const cli = resolve(process.env.WEWORKER_TEST_CLI);
  function run(args, status = 0) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    assert.equal(result.status, status, String(result.error || '') + (result.stderr + result.stdout).slice(-4000));
    return result.stdout || result.stderr;
  }
  function writePackage(version) {
    writeFileSync(join(pkg, 'manifest.json'), JSON.stringify({
      schema_version: 2, name: 'toolkit-fixture', version, description: 'Local Toolkit acceptance fixture',
      commands: ['echo', 'write'].map(id => ({ id, runtime: 'wewright', module: `wewright/commands/${id}.py`,
        description: 'Echo fixture parameters without external effects', safety: id === 'write' ? 'write' : 'read',
        schema: { type: 'object', properties: { count: { type: 'integer' } } } })),
    }));
    const source = `import json, sys\np = json.load(sys.stdin)\nif p.get("invalid_json"):\n    print("fixture invalid output")\n    sys.exit(0)\nprint(json.dumps({"command": sys.argv[1], "parameters": p, "version": "${version}"}))\nsys.exit(7 if p.get("fail") else 0)\n`;
    for (const id of ['echo', 'write']) writeFileSync(join(pkg, `wewright/commands/${id}.py`), source);
  }
  const call = (command, params, status = 0) => JSON.parse(run(['call', `toolkit-fixture.${command}`, '--args', JSON.stringify(params)], status));
  writePackage('1.0.0');
  run(['adapter', 'install', '--directory', pkg]);
  assert.ok(JSON.parse(run(['adapter', 'list', '--json'])).some(item => item.id === 'toolkit-fixture'));
  assert.match(run(['toolkit-fixture', 'echo', 'help']), /echo/);
  assert.match(run(['adapter', 'skill', 'toolkit-fixture']), /webcli call toolkit-fixture.echo/);
  assert.deepEqual(call('echo', { count: '007', nested: { enabled: false }, values: [1, '02'] }).parameters,
    { count: '007', nested: { enabled: false }, values: [1, '02'] });
  assert.match(run(['call', 'toolkit-fixture.write', '--args', '{}'], 1), /confirmation/i);
  assert.equal(call('write', { __confirmed: true }).command, 'write');
  assert.equal(call('echo', { fail: true }, 7).parameters.fail, true);
  assert.match(call('echo', { invalid_json: true }, 1).error, /JSON/);
  run(['adapter', 'use', 'toolkit-fixture', 'disabled']);
  const disabled = spawnSync(process.execPath, [cli, 'call', 'toolkit-fixture.echo', '--args', '{}'], { cwd: root, env, encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.notEqual(disabled.status, 0);
  assert.match(disabled.stderr + disabled.stdout, /unavailable|disabled/i);
  run(['adapter', 'use', 'toolkit-fixture', 'user']);
  writePackage('1.1.0');
  run(['adapter', 'install', '--directory', pkg]);
  assert.equal(call('echo', {}).version, '1.1.0');
  console.log('Toolkit acceptance: install, list, help, Skill, parameter fidelity, write gate, exit code, malformed output, disable/re-enable and update passed.');
});
