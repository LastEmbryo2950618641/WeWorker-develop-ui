import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { buildAdapterCatalog, assertAdapterIdentity } from './adapter-catalog.js';
import { adapterError, assertManagedDirectory, readPackageDirectory, writePackageDirectory } from './adapter-package-files.js';
import { resolveAdapterPaths } from './paths.js';

const inside = (root, target) => { const part = relative(root, target); return part === '' || (part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part)); };
function physicalDirectory(directory) {
  // Resolve the nearest existing ancestor, including a missing managed root.
  try { return realpathSync(directory); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const absolute = resolve(directory), parent = dirname(absolute);
    if (parent === absolute) throw error;
    return resolve(physicalDirectory(parent), basename(absolute));
  }
}

/** Export a verified built-in package; selection remains an explicit develop/use action. */
export function ejectAdapter(name, directory, options = {}) {
  assertAdapterIdentity(name);
  if (typeof directory !== 'string' || !directory.trim()) throw adapterError('EXPORT_DIRECTORY_REQUIRED', 'A new destination directory is required.');
  const paths = options.paths || resolveAdapterPaths(options);
  const catalog = buildAdapterCatalog({ ...options, paths });
  if (catalog.diagnostics.some(item => !item.name && !item.names)) throw adapterError('ADAPTER_CATALOG_UNAVAILABLE', 'Inspect the Adapter catalog before exporting.');
  const source = catalog.candidates.find(item => item.name === name && item.source === 'builtin');
  if (!source) throw adapterError('BUILTIN_ADAPTER_UNAVAILABLE', 'A valid built-in package is required for export.');
  const pkg = readPackageDirectory(source.root);
  if (pkg.digest !== source.digest) throw adapterError('ADAPTER_CONTENT_CHANGED', 'Built-in package changed during export.');
  const destination = resolve(directory);
  if (basename(destination) !== name) throw adapterError('EXPORT_NAME_MISMATCH', 'The destination directory name must equal the Adapter name.');
  const parent = dirname(destination);
  assertManagedDirectory(parent);
  const physicalTarget = resolve(realpathSync(parent), name);
  const protectedRoots = [paths.builtinDir, paths.userDir, paths.stateDir, paths.packageDir, paths.cacheDir, paths.workspaceDir,
    ...catalog.candidates.filter(item => item.source === 'development').map(item => item.root)].filter(Boolean);
  if (protectedRoots.some(root => inside(physicalDirectory(root), physicalTarget))) {
    throw adapterError('EXPORT_MANAGED_DESTINATION', 'Export to a new workspace outside managed Adapter directories.');
  }
  try { lstatSync(destination); throw adapterError('EXPORT_DESTINATION_EXISTS', 'The export destination already exists; it will not be overwritten.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  mkdirSync(destination); // Exclusive creation; do not merge or delete on failure.
  const exported = writePackageDirectory(destination, pkg.files);
  if (exported.digest !== pkg.digest) throw adapterError('EXPORT_CONTENT_CHANGED', 'Exported bytes changed; the package was not activated.');
  return { name, version: pkg.manifest.version, digest: pkg.digest, source: 'builtin', directory: destination,
    files: pkg.files.size, activated: false, next: { command: 'webcli adapter develop', directory: destination } };
}
