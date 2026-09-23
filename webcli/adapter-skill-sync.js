import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertAdapterIdentity } from './adapter-catalog.js';
import { assertManagedDirectory, assertManagedFile } from './adapter-package-files.js';
import { renameManagedFile } from './adapter-state.js';
import { managedAdapterSkill, managedAdapterViews } from './adapter-views.js';

const marker = '\n<!-- weworker-adapter-skill:';
const hash = (text) => createHash('sha256').update(text).digest('hex');

function readOwned(content) {
  const at = content.lastIndexOf(marker);
  if (at < 0 || !content.endsWith(' -->\n')) return null;
  try {
    const record = JSON.parse(content.slice(at + marker.length, -5));
    return record.schemaVersion === 1 && record.contentDigest === hash(content.slice(0, at)) ? record : null;
  } catch { return null; }
}

/** Historical model context must match both its file and the current package. */
export function createManagedAdapterSkillValidator() {
  let snapshot;
  return (content, directoryName = '') => {
    const marked = content.includes(marker);
    const reservedName = directoryName.startsWith('webcli-') ? directoryName.slice(7) : null;
    if (!marked && !reservedName) return true;
    try {
      snapshot ||= managedAdapterViews();
      if (!marked) return !snapshot.managedNames.has(reservedName);
      const record = readOwned(content);
      if (!record || record.status !== 'active' || (reservedName && record.name !== reservedName)) return false;
      const adapter = snapshot.adapters.find((entry) => entry.id === record.name);
      return !!adapter && adapter.profile === record.profile && adapter.digest === record.packageDigest;
    } catch { return false; }
  };
}
export const isManagedAdapterSkillCurrent = (content, directoryName) => createManagedAdapterSkillValidator()(content, directoryName);

function writeOwned(target, body, record) {
  const root = join(target, 'webcli-' + assertAdapterIdentity(record.name));
  assertManagedDirectory(root);
  mkdirSync(root, { recursive: true });
  const disabled = assertManagedFile(root, 'SKILL.md.disabled');
  const file = existsSync(disabled) ? disabled : assertManagedFile(root, 'SKILL.md');
  if (existsSync(file)) {
    const previous = readOwned(readFileSync(file, 'utf8'));
    if (!previous || previous.name !== record.name || previous.profile !== record.profile) return false;
  }
  const content = body + marker + JSON.stringify({ ...record, schemaVersion: 1, contentDigest: hash(body) }) + ' -->\n';
  const temporary = assertManagedFile(root, 'SKILL.' + randomUUID() + '.tmp');
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  renameManagedFile(temporary, file);
  return true;
}

/** Refresh only unmodified generated files owned by this profile. Never delete user Skills. */
export function syncManagedAdapterSkills({ target, snapshot, profile, adapterId = null }) {
  assertManagedDirectory(target);
  mkdirSync(target, { recursive: true });
  const active = new Map(snapshot.adapters.map((adapter) => [adapter.id, adapter]));
  let installed = 0, retired = 0;
  const preserved = [];
  for (const adapter of snapshot.adapters) {
    if (adapterId && adapter.id !== adapterId) continue;
    if (writeOwned(target, managedAdapterSkill(adapter), {
      name: adapter.id, profile, packageDigest: adapter.digest, version: adapter.version, status: 'active',
    })) installed++;
    else preserved.push(adapter.id);
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('webcli-')) continue;
    const name = entry.name.slice(7);
    if ((adapterId && name !== adapterId) || active.has(name)) continue;
    const disabled = assertManagedFile(target, entry.name + '/SKILL.md.disabled');
    const file = existsSync(disabled) ? disabled : assertManagedFile(target, entry.name + '/SKILL.md');
    if (!existsSync(file)) continue;
    const previous = readOwned(readFileSync(file, 'utf8'));
    if (!previous || previous.name !== name || previous.profile !== profile || previous.status === 'unavailable') continue;
    const body = '---\nname: ' + JSON.stringify('webcli-' + name) + '\ndescription: "Adapter unavailable; reload current catalog"\n---\n\n'
      + 'This Adapter is disabled, removed, or unavailable. Do not call tools from earlier versions of this Skill.\n';
    if (writeOwned(target, body, { name, profile, status: 'unavailable' })) retired++;
  }
  return { installed, retired, preserved };
}
