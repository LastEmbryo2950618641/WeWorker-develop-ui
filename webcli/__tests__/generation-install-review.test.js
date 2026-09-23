import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { resolveAdapterPaths } from '../paths.js';
import { validatePackageFiles } from '../adapter-package-files.js';
import { installAdapter } from '../adapter-install-store.js';
import { buildAdapterCatalog } from '../adapter-catalog.js';
import { describeGeneratedInstall, resolveGeneratedInstallApproval } from '../generation-harness/install-review.js';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'install-review-')); roots.push(root);
  return resolveAdapterPaths({ home: root, env: { WEWORKER_BUILD_PROFILE: 'public', WEWORKER_BUILTIN_ADAPTERS_DIR: join(root, 'builtin') } });
}
function pkg(version, hosts = ['example.com']) {
  return validatePackageFiles(new Map([
    ['manifest.json', Buffer.from(JSON.stringify({ schema_version: 2, name: 'fixture', version, match: hosts, description: 'Fixture', commands: [{ id: 'list', runtime: 'extension', module: 'extension/commands/list.js', description: 'Fixture', safety: 'read', schema: { type: 'object', properties: {} } }] }))],
    ['extension/commands/list.js', Buffer.from('/* fixture */')],
  ]));
}

it('reviews version, permissions and source from immutable package bytes and requires exact consent', () => {
  const paths = setup();
  installAdapter({ files: pkg('2.0.0').files, origin: { kind: 'local' } }, { paths });
  const incoming = pkg('1.0.0', ['example.com', 'example.org']);
  const review = describeGeneratedInstall({}, { paths, pkg: incoming });
  expect(review).toMatchObject({ version: '1.0.0', currentVersion: '2.0.0', downgrade: true, sourceChange: true, addedPermissions: ['host:example.org'], digest: incoming.digest });
  for (const approval of [undefined, { acceptChanges: true }, { reviewId: review.reviewId }]) {
    expect(() => resolveGeneratedInstallApproval(review, approval)).toThrow(/确认/);
  }
  expect(() => resolveGeneratedInstallApproval(review, { reviewId: 'stale', acceptChanges: true })).toThrow(/变化/);
  const accepted = resolveGeneratedInstallApproval(review, { reviewId: review.reviewId, acceptChanges: true });
  installAdapter({ files: incoming.files, origin: { kind: 'generated' }, ...accepted }, { paths });
  expect(buildAdapterCatalog({ paths }).effective[0]).toMatchObject({ version: '1.0.0', origin: { kind: 'generated' } });
});

it('rejects stale state under the installation lock without replacing the current package', () => {
  const paths = setup();
  const incoming = pkg('1.0.0');
  const review = describeGeneratedInstall({}, { paths, pkg: incoming });
  const newer = installAdapter({ files: pkg('2.0.0').files, origin: { kind: 'generated' } }, { paths });
  expect(() => installAdapter({ files: incoming.files, ...resolveGeneratedInstallApproval(review), origin: { kind: 'generated' } }, { paths })).toThrow(/state changed/);
  expect(buildAdapterCatalog({ paths }).effective[0].digest).toBe(newer.digest);
});
