import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAdapterPaths } from '../paths.js';
import { writePackageDirectory } from '../adapter-package-files.js';
import { installAdapter, selectAdapter } from '../adapter-install-store.js';
import { adapterStatus, validateAdapters } from '../adapter-diagnostics.js';
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'adapter-diagnostics-')); roots.push(root);
  const paths = resolveAdapterPaths({ home: root, env: { WEWORKER_BUILD_PROFILE: 'public', WEWORKER_BUILTIN_ADAPTERS_DIR: join(root, 'builtin') } });
  return { root, paths };
}
function files(source = 'throw new Error("must not execute"); module.exports = async () => [];') {
  return new Map([
    ['manifest.json', JSON.stringify({ schema_version: 2, name: 'example', version: '1.0.0', description: 'Public fixture', match: ['example.com'],
      commands: [{ id: 'read', runtime: 'extension', module: 'extension/commands/read.js', description: 'Read example', safety: 'read', schema: { type: 'object', properties: {} } }] })],
    ['extension/commands/read.js', source],
  ]);
}
it('compiles source without evaluating it, reports syntax failures and does not create registry state', () => {
  const { root, paths } = fixture(), directory = join(root, 'example');
  writePackageDirectory(directory, files());
  expect(validateAdapters({ directory })).toMatchObject({ ok: true, executed: false, summary: { packages: 1, commands: 1 } });
  writeFileSync(join(directory, 'extension/commands/read.js'), 'module.exports = ;');
  expect(validateAdapters({ directory })).toMatchObject({ ok: false, results: [{ errors: [{ code: 'JAVASCRIPT_SYNTAX', file: 'extension/commands/read.js' }] }] });
  expect(existsSync(paths.stateDir)).toBe(false);
});
it('keeps shadowed and disabled candidates visible and validates only active selections', () => {
  const { paths } = fixture();
  writePackageDirectory(join(paths.builtinDir, 'example'), files());
  installAdapter({ files: files(), origin: { kind: 'local' } }, { paths });
  const before = readFileSync(join(paths.stateDir, 'registry.json'));
  const status = adapterStatus('example', { paths });
  expect(status).toMatchObject({ ok: true, executed: false, items: [{ selection: 'user', active: { source: 'user' } }] });
  expect(status.items[0].candidates.map(item => item.source).sort()).toEqual(['builtin', 'user']);
  expect(JSON.stringify(status)).not.toContain(paths.userDir);
  expect(validateAdapters({ name: 'example', paths }).results[0].source).toBe('user');
  expect(readFileSync(join(paths.stateDir, 'registry.json'))).toEqual(before);
  selectAdapter('example', 'disabled', { paths });
  expect(adapterStatus('example', { paths }).items[0]).toMatchObject({ selection: 'disabled', active: null });
  expect(validateAdapters({ name: 'example', paths })).toMatchObject({ ok: false, diagnostics: [{ code: 'ADAPTER_NOT_ACTIVE' }] });
});
it('exposes tampered snapshots and global state failures without silently validating a fallback', () => {
  const { paths } = fixture();
  writePackageDirectory(join(paths.builtinDir, 'example'), files());
  const installed = installAdapter({ files: files(), origin: { kind: 'local' } }, { paths });
  writeFileSync(join(installed.executionRoot, 'extension/commands/read.js'), 'module.exports=()=>({changed:true});');
  const report = validateAdapters({ name: 'example', paths });
  expect(report.ok).toBe(false); expect(report.results).toEqual([]);
  expect(report.diagnostics.some(item => item.code === 'ADAPTER_CONTENT_CHANGED')).toBe(true);
  expect(adapterStatus('example', { paths }).items[0].active).toBeNull();
  writeFileSync(join(paths.stateDir, 'registry.json'), 'invalid');
  expect(validateAdapters({ paths })).toMatchObject({ ok: false, diagnostics: [{ code: 'INVALID_ADAPTER_STATE' }] });
});
it('fails an unknown target while reporting an empty catalog accurately', () => {
  const { paths } = fixture();
  expect(adapterStatus('missing', { paths })).toMatchObject({ ok: false, items: [], diagnostics: [{ code: 'ADAPTER_NOT_FOUND' }] });
  expect(validateAdapters({ paths })).toMatchObject({ ok: true, results: [], summary: { commands: 0, packages: 0 } });
});
