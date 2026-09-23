import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapterError, assertManagedDirectory, assertManagedFile } from './adapter-package-files.js';

const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function renameManagedFile(source, target) {
  for (let attempt = 0; ; attempt++) {
    try { renameSync(source, target); return; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt === 4) throw error;
      nap(10 * 2 ** attempt);
    }
  }
}

export function readAdapterState(paths) {
  const file = assertManagedFile(paths.stateDir, 'registry.json');
  const empty = { schemaVersion: 1, profile: paths.profile, revision: 0, installations: Object.create(null), selections: Object.create(null), development: Object.create(null) };
  if (!existsSync(file)) return empty;
  if (!lstatSync(file).isFile() || lstatSync(file).size > 4 * 1024 * 1024) throw adapterError('INVALID_ADAPTER_STATE', 'Invalid Adapter state file.');
  let raw;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw adapterError('INVALID_ADAPTER_STATE', 'Adapter state could not be read; existing packages were not modified.'); }
  if (raw?.schemaVersion !== 1 || raw.profile !== paths.profile || !Number.isSafeInteger(raw.revision) || raw.revision < 0) {
    throw adapterError('INVALID_ADAPTER_STATE', 'Adapter state version or profile does not match.');
  }
  for (const field of ['installations', 'selections', 'development']) {
    if (!raw[field] || typeof raw[field] !== 'object' || Array.isArray(raw[field])) throw adapterError('INVALID_ADAPTER_STATE', 'Invalid Adapter state collection.');
    empty[field] = Object.assign(Object.create(null), raw[field]);
  }
  empty.revision = raw.revision;
  return empty;
}

export function writeAdapterState(paths, state) {
  writeManagedJson(paths.stateDir, 'registry.json', state);
}

export function writeManagedJson(root, name, value) {
  assertManagedDirectory(root);
  mkdirSync(root, { recursive: true });
  const target = assertManagedFile(root, name);
  const temporary = assertManagedFile(root, name + '.' + randomUUID() + '.tmp');
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameManagedFile(temporary, target);
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

/** Locks serialize a profile and its chosen user root. Never steal a live lock. */
export function withAdapterStoreLock(paths, operation) {
  assertManagedDirectory(paths.userDir);
  assertManagedDirectory(paths.stateDir);
  mkdirSync(paths.userDir, { recursive: true });
  mkdirSync(paths.stateDir, { recursive: true });
  const lockRoot = assertManagedFile(paths.userDir, '.adapter-install-lock');
  const archive = assertManagedFile(paths.userDir, '.transactions');
  assertManagedDirectory(archive);
  mkdirSync(archive, { recursive: true });
  const token = randomUUID();
  try { mkdirSync(lockRoot); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    assertManagedDirectory(lockRoot);
    let owner;
    try { owner = JSON.parse(readFileSync(assertManagedFile(lockRoot, 'owner.json'), 'utf8')); }
    catch { throw adapterError('ADAPTER_STORE_LOCKED', 'An incomplete Adapter lock requires inspection.'); }
    if (processIsAlive(owner.pid)) throw adapterError('ADAPTER_STORE_LOCKED', 'Another Adapter operation is running.');
    // Only one recovery contender can claim the abandoned directory.
    try { mkdirSync(join(lockRoot, 'recovery')); }
    catch { throw adapterError('ADAPTER_STORE_LOCKED', 'Adapter lock recovery is already in progress.'); }
    renameManagedFile(lockRoot, join(archive, 'abandoned-lock-' + token));
    try { mkdirSync(lockRoot); }
    catch { throw adapterError('ADAPTER_STORE_LOCKED', 'Another Adapter operation acquired the recovered lock.'); }
  }
  writeFileSync(join(lockRoot, 'owner.json'), JSON.stringify({ pid: process.pid, token, profile: paths.profile }), { flag: 'wx', mode: 0o600 });
  try { return operation(); }
  finally {
    // Archive our own lock instead of deleting arbitrary paths after recovery.
    const owner = JSON.parse(readFileSync(join(lockRoot, 'owner.json'), 'utf8'));
    if (owner.token !== token) throw adapterError('ADAPTER_STORE_LOCKED', 'Adapter lock ownership changed.');
    renameManagedFile(lockRoot, join(archive, 'completed-lock-' + token));
  }
}
