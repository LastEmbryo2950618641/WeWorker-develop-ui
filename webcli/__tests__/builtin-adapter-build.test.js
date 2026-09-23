import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { selectBuiltinAdapters, writeBuiltinAdapters, validateBuiltinOutput } from '../builtin-adapter-build.js';
import { resolveAdapterPaths, resolveExtensionDir } from '../paths.js';
import { buildAdapterCatalog } from '../adapter-catalog.js';

const roots = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-build-'));
  roots.push(root);
  const builtinDir = path.join(root, 'source');
  const legacyDir = path.join(root, 'legacy');
  fs.mkdirSync(builtinDir);
  fs.mkdirSync(legacyDir);
  return { root, builtinDir, legacyDir };
}
function makePackage(builtinDir, name) {
  const root = path.join(builtinDir, name);
  fs.mkdirSync(path.join(root, 'extension/commands'), { recursive: true });
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
    schema_version: 2, name, version: '1.0.0', description: 'Fixture', match: [name + '.example.com'],
    commands: [{ id: 'list', runtime: 'extension', module: 'extension/commands/list.js', description: 'List', schema: {} }],
  }));
  fs.writeFileSync(path.join(root, 'extension/commands/list.js'), '__webcliRegisterCommand("list", () => []);');
  return root;
}
function makeLegacy(legacyDir, name) {
  fs.mkdirSync(path.join(legacyDir, name));
  fs.writeFileSync(path.join(legacyDir, name, 'manifest.json'), JSON.stringify({ id: name }));
}
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

it('packages only the selected profile and resolves the relocated artifact without source paths', () => {
  const dirs = fixture();
  makePackage(dirs.builtinDir, 'public-fixture');
  makePackage(dirs.builtinDir, 'private-fixture');
  makeLegacy(dirs.legacyDir, 'public-fixture');
  makeLegacy(dirs.legacyDir, 'old-fixture');
  const selection = selectBuiltinAdapters({ ...dirs, names: ['public-fixture', 'old-fixture'] });
  expect(selection.legacy.map(x => x.name)).toEqual(['old-fixture']);
  const outputDir = path.join(dirs.root, 'resources/adapters');
  const metadata = writeBuiltinAdapters({ selection, outputDir, profile: 'internal' });
  expect(metadata.adapters.map(x => x.name)).toEqual(['public-fixture']);
  expect(fs.existsSync(path.join(outputDir, 'private-fixture'))).toBe(false);
  const paths = resolveAdapterPaths({ env: { WEWORKER_RESOURCES_PATH: path.dirname(outputDir) }, home: path.join(dirs.root, 'home') });
  expect(paths.profile).toBe('internal');
  expect(paths.userDir).toBe(path.join(dirs.root, 'home/.weworker/adapters/.profiles/internal'));
  const catalog = buildAdapterCatalog({ paths });
  expect(catalog.diagnostics).toEqual([]);
  expect(catalog.effective.map(x => [x.name, x.digest])).toEqual(metadata.adapters.map(x => [x.name, x.digest]));
  expect(() => resolveAdapterPaths({ env: { WEWORKER_RESOURCES_PATH: path.dirname(outputDir), WEWORKER_BUILD_PROFILE: 'public' } })).toThrow(/does not match/);
});

it('fails on a missing, broken, linked or duplicate selection instead of using a legacy copy', () => {
  const dirs = fixture();
  expect(() => selectBuiltinAdapters({ ...dirs, names: ['missing'] })).toThrow();
  const pkg = makePackage(dirs.builtinDir, 'fixture');
  makeLegacy(dirs.legacyDir, 'fixture');
  expect(() => selectBuiltinAdapters({ ...dirs, names: ['fixture', 'Fixture'] })).toThrow(/Duplicate/);
  fs.writeFileSync(path.join(pkg, 'manifest.json'), '{}');
  expect(() => selectBuiltinAdapters({ ...dirs, names: ['fixture'] })).toThrow(/schema_version/);
  fs.symlinkSync(pkg, path.join(dirs.builtinDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => selectBuiltinAdapters({ ...dirs, names: ['linked'] })).toThrow(/regular directory/);
  expect(() => selectBuiltinAdapters({ ...dirs, names: ['../outside'] })).toThrow();
});

it('writes the validated bytes even if source files change after selection', () => {
  const dirs = fixture();
  const pkg = makePackage(dirs.builtinDir, 'fixture');
  const selection = selectBuiltinAdapters({ ...dirs, names: ['fixture'] });
  fs.writeFileSync(path.join(pkg, 'extension/commands/list.js'), 'throw new Error("changed");');
  const outputDir = path.join(dirs.root, 'output');
  writeBuiltinAdapters({ selection, outputDir, profile: 'public' });
  expect(fs.readFileSync(path.join(outputDir, 'fixture/extension/commands/list.js'), 'utf8')).not.toContain('changed');
  expect(fs.readFileSync(path.join(pkg, 'extension/commands/list.js'), 'utf8')).toContain('changed');
});

it('rejects missing packaged metadata and chooses packaged extension resources before source copies', () => {
  const dirs = fixture();
  const resources = path.join(dirs.root, 'resources');
  fs.mkdirSync(path.join(resources, 'extension'), { recursive: true });
  fs.mkdirSync(path.join(resources, 'webcli/extension'), { recursive: true });
  expect(() => resolveAdapterPaths({ env: { WEWORKER_RESOURCES_PATH: resources } })).toThrow(/metadata is missing/);
  expect(resolveExtensionDir({ env: {}, baseDir: path.join(resources, 'webcli') })).toBe(path.join(resources, 'webcli/extension'));
  expect(resolveExtensionDir({ env: { WEWORKER_RESOURCES_PATH: resources }, baseDir: dirs.root })).toBe(path.join(resources, 'extension'));
});

it('validates exact prepared resources and detects stale or modified packages', () => {
  const dirs = fixture();
  makePackage(dirs.builtinDir, 'fixture');
  const outputDir = path.join(dirs.root, 'output');
  const selection = selectBuiltinAdapters({ ...dirs, names: ['fixture'] });
  const metadata = writeBuiltinAdapters({ selection, outputDir, profile: 'public' });
  expect(validateBuiltinOutput(outputDir)).toEqual(metadata);
  fs.mkdirSync(path.join(outputDir, 'stale'));
  expect(() => validateBuiltinOutput(outputDir)).toThrow(/resource set/);
  fs.rmdirSync(path.join(outputDir, 'stale'));
  fs.writeFileSync(path.join(outputDir, 'fixture/extension/commands/list.js'), 'changed');
  expect(() => validateBuiltinOutput(outputDir)).toThrow(/digest/);
});

it('a checkout reads the prepared profile instead of every source package or a stale npm copy', () => {
  const dirs = fixture();
  const baseDir = path.join(dirs.root, 'webcli');
  fs.mkdirSync(path.join(dirs.root, 'weworker'), { recursive: true });
  fs.writeFileSync(path.join(dirs.root, 'weworker/build-profile.json'), '{}');
  fs.mkdirSync(path.join(dirs.root, 'adapters'));
  expect(() => resolveAdapterPaths({ env: {}, baseDir })).toThrow(/prepare/);
  const outputDir = path.join(dirs.root, 'weworker/build/builtin-adapters');
  writeBuiltinAdapters({ selection: { packages: [], legacy: [] }, outputDir, profile: 'internal' });
  fs.mkdirSync(path.join(dirs.root, 'weworker/build/extension-dist'));
  fs.mkdirSync(path.join(baseDir, 'extension'), { recursive: true });
  const paths = resolveAdapterPaths({ env: {}, baseDir, home: path.join(dirs.root, 'home') });
  expect(paths.profile).toBe('internal');
  expect(paths.builtinDir).toBe(outputDir);
  expect(resolveExtensionDir({ env: {}, baseDir })).toBe(path.join(dirs.root, 'weworker/build/extension-dist'));
});

it('runtime catalog enforcement matches built-in packages to profile metadata', () => {
  const dirs = fixture();
  const pkg = makePackage(dirs.builtinDir, 'fixture');
  const outputDir = path.join(dirs.root, 'output');
  const selection = selectBuiltinAdapters({ ...dirs, names: ['fixture'] });
  const metadata = writeBuiltinAdapters({ selection, outputDir, profile: 'public' });
  const paths = resolveAdapterPaths({ env: { WEWORKER_BUILTIN_ADAPTERS_DIR: outputDir }, home: path.join(dirs.root, 'home') });
  expect(buildAdapterCatalog({ paths }).effective.map(x => x.name)).toEqual(['fixture']);
  fs.writeFileSync(path.join(outputDir, 'fixture/extension/commands/list.js'), 'changed');
  let catalog = buildAdapterCatalog({ paths });
  expect(catalog.effective).toHaveLength(0);
  expect(catalog.diagnostics.some(x => x.code === 'BUILTIN_ADAPTER_CONTENT_CHANGED')).toBe(true);
  fs.writeFileSync(path.join(outputDir, 'fixture/extension/commands/list.js'), '__webcliRegisterCommand("list", () => []);');
  makePackage(outputDir, 'unexpected');
  catalog = buildAdapterCatalog({ paths });
  expect(catalog.effective.map(x => x.name)).toEqual(['fixture']);
  expect(catalog.diagnostics.some(x => x.code === 'UNEXPECTED_BUILTIN_ADAPTER')).toBe(true);
  const tampered = structuredClone(metadata);
  tampered.adapters[0].extra = true;
  fs.writeFileSync(path.join(outputDir, '.profile.json'), JSON.stringify(tampered));
  expect(() => validateBuiltinOutput(outputDir)).toThrow(/profile entry/);
});
