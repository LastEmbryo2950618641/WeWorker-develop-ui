import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditAdapterConventions, conventionRules } from '../adapter-conventions.js';
import { writePackageDirectory } from '../adapter-package-files.js';
import { resolveAdapterPaths } from '../paths.js';
import { installAdapter } from '../adapter-install-store.js';
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(source, commands) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'example-conventions-')); roots.push(root);
  const paths = resolveAdapterPaths({ home: root, env: { WEWORKER_BUILD_PROFILE: 'public', WEWORKER_BUILTIN_ADAPTERS_DIR: path.join(root, 'builtin') } });
  const defaultCommand = { id: 'read', runtime: 'http', description: 'Read public item', module: 'http/commands/read.js', safety: 'read',
    schema: { type: 'object', properties: {} }, http: { version: 1, strategy: 'PUBLIC_API', origins: ['https://example.com'] } };
  const manifest = { schema_version: 2, name: 'example', version: '1.0.0', description: 'Public fixture', commands: (commands || [{}]).map(overrides => ({ ...defaultCommand, ...overrides })) };
  const files = new Map([['manifest.json', JSON.stringify(manifest)], ...manifest.commands.map(command => [command.module, source])]);
  const directory = path.join(root, 'example'); writePackageDirectory(directory, files);
  return { root, paths, directory, files };
}
it('reports all seven actual heuristic categories without evaluating source or exposing source text', () => {
  const f = fixture(`throw new Error('must not run'); module.exports = args => {
    const limit = Math.min(args.limit, 10); const value = args.value || 'unknown';
    try { return { itemId: 1, title: value, extra: limit }; } catch { return []; }
  };`, [{ safety: undefined }, { id: 'create', module: 'http/commands/create.js', safety: 'write' }]);
  const result = auditAdapterConventions({ directory: f.directory, columnMapping: () => ({ itemId: 'ID', title: 'Title' }) });
  expect(result.ok).toBe(false); expect(result.executed).toBe(false);
  expect([...new Set(result.findings.map(item => item.rule))].sort()).toEqual([...conventionRules].sort());
  expect(result.summary.errors).toBe(0); expect(result.packages[0].javascriptFiles).toBe(2);
  expect(JSON.stringify(result)).not.toContain('must not run'); expect(JSON.stringify(result)).not.toContain(f.root);
  expect(result.findings.find(item => item.rule === 'display-column-omission')).toMatchObject({ missing: ['extra'], line: 3 });
  expect(fs.existsSync(f.paths.stateDir)).toBe(false);
});
it('ignores comments and documented reverse write pairs; clean audit is still static', () => {
  const f = fixture(`// return { itemId: 1, extra: 2 }; Math.min(args.limit, 10)
/* catch { return []; } const x = input || 'unknown'; */
module.exports = () => ({ ok: true });`, [{ id: 'like', module: 'http/commands/like.js', safety: 'write' }, { id: 'unlike', module: 'http/commands/unlike.js', safety: 'write' }]);
  expect(auditAdapterConventions({ directory: f.directory, columnMapping: () => ({ title: 'Title' }) })).toMatchObject({ ok: true, executed: false, findings: [], summary: { commands: 2 } });
});
it('retains selected digest checks, reports invalid JavaScript, and rejects damaged installed packages', () => {
  const f = fixture('module.exports = () => ({ ok: true });');
  const installed = installAdapter({ files: f.files, origin: { kind: 'local' } }, { paths: f.paths });
  expect(auditAdapterConventions({ paths: f.paths, name: 'example' })).toMatchObject({ ok: true, packages: [{ source: 'user', digest: installed.digest }] });
  fs.writeFileSync(path.join(installed.executionRoot, 'http/commands/read.js'), 'module.exports = () => ({ changed: true });');
  const damaged = auditAdapterConventions({ paths: f.paths, name: 'example' });
  expect(damaged).toMatchObject({ ok: false, packages: [] });
  expect(damaged.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'example', code: 'ADAPTER_CONTENT_CHANGED' }), expect.objectContaining({ name: 'example', code: 'ADAPTER_NOT_ACTIVE' })]));
  fs.writeFileSync(path.join(f.directory, 'http/commands/read.js'), 'module.exports = ;');
  expect(auditAdapterConventions({ directory: f.directory })).toMatchObject({ ok: false, packages: [{ errors: [{ code: 'JAVASCRIPT_SYNTAX' }] }] });
  expect(auditAdapterConventions({ paths: f.paths, name: 'missing' }).ok).toBe(false);
});
