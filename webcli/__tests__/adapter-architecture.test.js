import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveAdapterPaths, resolveExtensionDir, resolveUserAdaptersDir, resolveBuiltinAdaptersDir } from '../paths.js';
import { loadV2Adapters, validateV2AdapterDir, validateV2Manifest } from '../adapter-package-v2.js';
import { buildAdapterCatalog } from '../adapter-catalog.js';

const roots = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'adapter-architecture-'));
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const manifest = (name = 'demo') => ({
  schema_version: 2, name, version: '1.0.0', description: 'Fixture',
  match: ['example.com'],
  commands: [{ id: 'list', runtime: 'extension', module: 'extension/commands/list.js',
    description: 'List fixture records', schema: { type: 'object', properties: {} } }],
});
function makeAdapter(root, name = 'demo') {
  const dir = join(root, name);
  mkdirSync(join(dir, 'extension/commands'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest(name)));
  writeFileSync(join(dir, 'extension/commands/list.js'), '(function () {})();');
  return dir;
}

describe('host Adapter paths', () => {
  it('uses a stable user root even if the standalone legacy directory exists', () => {
    const home = fixture();
    mkdirSync(join(home, '.webcli/adapters'), { recursive: true });
    expect(resolveUserAdaptersDir({ env: { WEWORKER_BUILTIN_ADAPTERS_DIR: join(home, 'builtin') }, home })).toBe(join(home, '.weworker/adapters'));
  });
  it('uses the same explicit root for the host and standalone CLI', () => {
    const root = fixture();
    expect(resolveUserAdaptersDir({ env: { WEBCLI_ADAPTERS_DIR: root } })).toBe(root);
    expect(resolveUserAdaptersDir({ env: { WEWORKER_USER_ADAPTERS_DIR: root } })).toBe(root);
    expect(() => resolveUserAdaptersDir({ env: { WEBCLI_ADAPTERS_DIR: root, WEWORKER_USER_ADAPTERS_DIR: join(root, 'different') } })).toThrow(/Conflicting/);
  });
  it('isolates mutable metadata by profile without changing the package identity', () => {
    const home = fixture();
    const env = { WEWORKER_BUILTIN_ADAPTERS_DIR: join(home, 'builtin') };
    const pub = resolveAdapterPaths({ env, home });
    const custom = resolveAdapterPaths({ env: { ...env, WEWORKER_BUILD_PROFILE: 'custom' }, home });
    expect(pub.userDir).not.toBe(custom.userDir);
    expect(custom.userDir).toBe(join(home, '.weworker/adapters/.profiles/custom'));
    expect(pub.stateDir).not.toBe(custom.stateDir);
    expect(pub.workspaceDir).not.toBe(custom.workspaceDir);
    expect(pub.cacheDir).not.toBe(custom.cacheDir);
    expect(() => resolveAdapterPaths({ env: { ...env, WEWORKER_BUILD_PROFILE: '../escape' }, home })).toThrow(/Invalid/);
  });
  it('rejects an explicit root already owned by another profile', () => {
    const root = fixture();
    const userDir = join(root, 'shared-user');
    mkdirSync(userDir);
    writeFileSync(join(userDir, '.adapter-profile.json'), JSON.stringify({ profile: 'public' }));
    expect(() => resolveAdapterPaths({
      env: { WEWORKER_BUILD_PROFILE: 'custom', WEWORKER_BUILTIN_ADAPTERS_DIR: join(root, 'builtin'), WEWORKER_USER_ADAPTERS_DIR: userDir },
      home: root,
    })).toThrow(/different profile/);
  });
  it('prefers prepared checkout outputs over stale standalone npm resources', () => {
    const root = fixture();
    const webcliDir = join(root, 'webcli');
    mkdirSync(join(webcliDir, 'adapters'), { recursive: true });
    mkdirSync(join(webcliDir, 'extension'), { recursive: true });
    mkdirSync(join(root, 'weworker'), { recursive: true });
    writeFileSync(join(root, 'weworker/build-profile.json'), '{}');
    expect(() => resolveBuiltinAdaptersDir({ env: {}, baseDir: webcliDir })).toThrow(/prepare/);
    expect(() => resolveExtensionDir({ env: {}, baseDir: webcliDir })).toThrow(/prepare/);
    const preparedBuiltin = join(root, 'weworker/build/builtin-adapters');
    mkdirSync(preparedBuiltin, { recursive: true });
    writeFileSync(join(preparedBuiltin, '.profile.json'), JSON.stringify({ schema_version: 1, profile: 'internal', adapters: [], legacy: [] }));
    mkdirSync(join(root, 'weworker/build/extension-dist'), { recursive: true });
    expect(resolveBuiltinAdaptersDir({ env: {}, baseDir: webcliDir })).toBe(preparedBuiltin);
    expect(resolveExtensionDir({ env: {}, baseDir: webcliDir })).toBe(join(root, 'weworker/build/extension-dist'));
  });  it('honors the host built-in resource root before any source checkout', () => {
    const root = fixture();
    const injected = join(root, 'resources/adapters');
    expect(resolveBuiltinAdaptersDir({ env: { WEWORKER_BUILTIN_ADAPTERS_DIR: injected }, baseDir: root })).toBe(injected);
    mkdirSync(injected, { recursive: true });
    expect(resolveBuiltinAdaptersDir({ env: { WEWORKER_RESOURCES_PATH: join(root, 'resources') }, baseDir: root })).toBe(injected);
    expect(resolveBuiltinAdaptersDir({ env: {}, baseDir: join(root, 'npm') })).toBe(resolve(root, 'adapters'));
  });
});

describe('portable package validation', () => {
  it.each(['CON', 'nul.txt', 'com1', 'lpt9.example', 'name.', '../escape', 'two words'])('rejects nonportable name %s', (name) => {
    expect(() => validateV2Manifest(manifest(name), name)).toThrow(/invalid adapter name/);
  });
  it.each(['latest', '1', '01.0.0', '1.0', '1.0.0-01', '1.0.0-..', '1.0.0+..'])('rejects invalid package version %s', (version) => {
    expect(() => validateV2Manifest({ ...manifest(), version }, 'demo')).toThrow(/version/);
  });
  it.each(['1.0.0-rc.1', '1.0.0+build.01'])('accepts semantic package version %s', (version) => {
    expect(validateV2Manifest({ ...manifest(), version }, 'demo').manifest.version).toBe(version);
  });
  it('accepts a real package and refuses a directory junction as its root', () => {
    const root = fixture();
    const adapter = makeAdapter(root);
    expect(validateV2AdapterDir(adapter).name).toBe('demo');
    const link = join(root, 'linked');
    symlinkSync(adapter, link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => validateV2AdapterDir(link)).toThrow(/regular directory/);
  });
  it('cannot execute commands reached through a junction', () => {
    const root = fixture();
    const builtin = join(root, 'builtin');
    const external = join(root, 'external');
    mkdirSync(join(builtin, 'demo'), { recursive: true });
    mkdirSync(join(external, 'commands'), { recursive: true });
    writeFileSync(join(external, 'commands/list.js'), 'throw new Error("must not run")');
    writeFileSync(join(builtin, 'demo/manifest.json'), JSON.stringify(manifest()));
    symlinkSync(external, join(builtin, 'demo/extension'), process.platform === 'win32' ? 'junction' : 'dir');
    const catalog = buildAdapterCatalog({ builtinDir: builtin, userDir: join(root, 'empty') });
    expect(catalog.effective).toHaveLength(0);
    expect(catalog.diagnostics.some((item) => item.name === 'demo')).toBe(true);
  });

  it('rejects cross-source names that differ only in case on every platform', () => {
    const root = fixture();
    const builtin = join(root, 'builtin');
    const user = join(root, 'user');
    makeAdapter(builtin, 'Demo');
    makeAdapter(user, 'demo');
    const catalog = buildAdapterCatalog({ builtinDir: builtin, userDir: user });
    expect(catalog.effective).toHaveLength(0);
    expect(catalog.diagnostics.some((item) => item.code === 'ADAPTER_NAME_COLLISION')).toBe(true);
  });

  it('rejects control characters in package identities', () => {
    const name = 'bad' + String.fromCharCode(0) + 'name';
    expect(() => validateV2Manifest(manifest(name), name)).toThrow(/invalid adapter name/);
  });
});
