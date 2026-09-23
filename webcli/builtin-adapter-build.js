import fs from 'node:fs';
import path from 'node:path';
import { assertAdapterIdentity } from './adapter-catalog.js';
import { assertManagedDirectory, assertManagedFile, readPackageDirectory, writePackageDirectory } from './adapter-package-files.js';

const PROFILE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const RESERVED_PROFILE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export function isValidBuiltinProfile(profile) {
  return typeof profile === 'string' && PROFILE_PATTERN.test(profile) && !RESERVED_PROFILE.test(profile);
}

function validateMetadataEntries(metadata) {
  if (metadata?.schema_version !== 1 || !isValidBuiltinProfile(metadata.profile)
      || !Array.isArray(metadata.adapters) || !Array.isArray(metadata.legacy)) {
    throw new Error('Invalid built-in Adapter profile metadata.');
  }
  const names = new Set();
  for (const entry of metadata.adapters) {
    if (!entry || Object.keys(entry).sort().join(',') !== 'digest,name,version'
        || !DIGEST_PATTERN.test(entry.digest) || typeof entry.version !== 'string') {
      throw new Error('Invalid built-in Adapter profile entry.');
    }
    assertAdapterIdentity(entry.name);
    if (names.has(entry.name.toLowerCase())) throw new Error('Duplicate built-in Adapter identity.');
    names.add(entry.name.toLowerCase());
  }
  for (const name of metadata.legacy) {
    assertAdapterIdentity(name);
    if (names.has(name.toLowerCase())) throw new Error('Duplicate built-in Adapter identity.');
    names.add(name.toLowerCase());
  }
  return metadata;
}

/** Resolve the complete profile before touching generated output. A broken v2
 * package must never silently fall back to an older Extension copy. */
export function selectBuiltinAdapters({ names, builtinDir, legacyDir }) {
  assertManagedDirectory(builtinDir);
  assertManagedDirectory(legacyDir);
  const packages = [];
  const legacy = [];
  const seen = new Set();
  for (const name of names) {
    assertAdapterIdentity(name);
    if (seen.has(name.toLowerCase())) throw new Error('Duplicate build Adapter identity.');
    seen.add(name.toLowerCase());
    const root = path.join(builtinDir, name);
    if (fs.existsSync(root)) {
      packages.push(readPackageDirectory(root));
      continue;
    }
    const legacyRoot = path.join(legacyDir, name);
    assertManagedDirectory(legacyRoot);
    const manifestPath = assertManagedFile(legacyRoot, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.id !== name || manifest.schema_version === 2) throw new Error('Invalid legacy build Adapter identity.');
    legacy.push({ name, root: legacyRoot, manifest });
  }
  return { packages, legacy };
}

/** Caller owns and clears this generated directory; never writes to sources. */
export function writeBuiltinAdapters({ selection, outputDir, profile }) {
  if (!isValidBuiltinProfile(profile)) throw new Error('Invalid Adapter build profile.');
  assertManagedDirectory(outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const entries = [];
  for (const pkg of selection.packages) {
    const written = writePackageDirectory(path.join(outputDir, pkg.name), pkg.files);
    if (written.digest !== pkg.digest) throw new Error('Built-in Adapter digest changed while packaging.');
    entries.push({ name: pkg.name, version: pkg.manifest.version, digest: pkg.digest });
  }
  const metadata = validateMetadataEntries({
    schema_version: 1, profile, adapters: entries,
    legacy: selection.legacy.map(({ name }) => name),
  });
  fs.writeFileSync(path.join(outputDir, '.profile.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
  return metadata;
}

export function validateBuiltinOutput(outputDir) {
  assertManagedDirectory(outputDir);
  const metadataPath = path.join(outputDir, '.profile.json');
  const stat = fs.lstatSync(metadataPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Built-in Adapter profile metadata must be a regular file.');
  const metadata = validateMetadataEntries(JSON.parse(fs.readFileSync(metadataPath, 'utf8')));
  const actual = fs.readdirSync(outputDir).filter((name) => name !== '.profile.json').sort();
  const expected = metadata.adapters.map((entry) => entry.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Built-in Adapter resource set does not match its profile.');
  for (const entry of metadata.adapters) {
    const pkg = readPackageDirectory(path.join(outputDir, entry.name));
    if (pkg.digest !== entry.digest || pkg.manifest.version !== entry.version) throw new Error('Built-in Adapter resource digest does not match its profile.');
  }
  return metadata;
}
