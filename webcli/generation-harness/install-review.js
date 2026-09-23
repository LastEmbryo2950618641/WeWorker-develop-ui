import { createHash } from 'node:crypto';
import { resolveAdapterPaths } from '../paths.js';
import { readAdapterState } from '../adapter-state.js';
import { adapterPermissions, buildAdapterCatalog } from '../adapter-catalog.js';
import { compareAdapterVersions } from '../adapter-install-store.js';
import { readPackageDirectory, adapterError } from '../adapter-package-files.js';

export function describeGeneratedInstall(draft, { paths = resolveAdapterPaths(), pkg = readPackageDirectory(draft.adapterDir) } = {}) {
  const state = readAdapterState(paths);
  const catalog = buildAdapterCatalog({ paths, state });
  const active = catalog.effective.find(entry => entry.name === pkg.name);
  const prior = state.installations[pkg.name];
  const base = prior ? { version: prior.version, permissions: prior.grants || [] } : active;
  const permissions = adapterPermissions(pkg.manifest);
  const review = {
    profile: paths.profile, name: pkg.name, version: pkg.manifest.version, digest: pkg.digest, stateRevision: state.revision,
    baselineDigest: active?.digest || null,
    currentVersion: base?.version || null,
    currentSource: prior?.origin?.kind || active?.source || null,
    targetSource: 'generated',
    permissions,
    addedPermissions: base ? permissions.filter(permission => !base.permissions.includes(permission)) : [],
    sourceChange: Boolean(prior && prior.origin?.kind !== 'generated'),
    downgrade: Boolean(base && compareAdapterVersions(pkg.manifest.version, base.version) < 0),
  };
  return { ...review, reviewId: createHash('sha256').update(JSON.stringify(review)).digest('hex') };
}

export function resolveGeneratedInstallApproval(review, approval = {}) {
  if (approval.reviewId && approval.reviewId !== review.reviewId) throw adapterError('ADAPTER_REVIEW_CHANGED', '安装内容或本机状态已变化，请重新检查安装信息。');
  const changes = review.sourceChange || review.downgrade || review.addedPermissions.length > 0;
  if (changes && (approval.reviewId !== review.reviewId || approval.acceptChanges !== true)) throw adapterError('ADAPTER_INSTALL_REVIEW_REQUIRED', '请确认安装评审中的来源、权限或版本变化。');
  return { expectedStateRevision: review.stateRevision, allowSourceChange: changes && review.sourceChange,
    allowDowngrade: changes && review.downgrade, allowPermissionChange: changes && review.addedPermissions.length > 0 };
}
