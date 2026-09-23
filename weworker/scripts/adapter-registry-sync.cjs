'use strict';

const fs = require('fs');
const path = require('path');

/** Default site icon key when manifest.icon is omitted. */
const DEFAULT_ICON = 'globe';

/** Registry-only fields copied from legacy registry.json into manifest.json. */
const REGISTRY_METADATA_FIELDS = [
  'icon',
  'scenarios',
  'detail_description',
  'test_prompts',
  'i18n',
  'prompt_var_display',
  'route_templates',
  'hidden',
  'enabled',
  'verified_on',
];

function listAdapterManifestPaths(adaptersDir) {
  return fs.readdirSync(adaptersDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.resolve(adaptersDir, entry.name, 'manifest.json'))
    .filter((manifestPath) => fs.existsSync(manifestPath));
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function loadManifestById(adaptersDir) {
  const byId = new Map();
  for (const manifestPath of listAdapterManifestPaths(adaptersDir)) {
    try {
      const manifest = readJsonFile(manifestPath);
      if (!manifest?.id) continue;
      byId.set(manifest.id, { manifest, manifestPath });
    } catch (err) {
      console.warn(`[adapter-registry-sync] WARNING: Failed to read ${manifestPath}: ${err.message}`);
    }
  }
  return byId;
}

function buildRegistryFromManifests(manifests, { defaultIcon = DEFAULT_ICON, preserveOrder = false } = {}) {
  const adapters = [...manifests]
    .filter((manifest) => manifest?.id);
  if (!preserveOrder) {
    adapters.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    defaults: { icon: defaultIcon },
    adapters,
  };
}

function mergeRegistryEntryIntoManifest(manifest, registryEntry) {
  const next = { ...manifest };
  for (const field of REGISTRY_METADATA_FIELDS) {
    if (registryEntry[field] !== undefined) next[field] = registryEntry[field];
  }
  return next;
}

/** One-time migration helper: copy legacy registry metadata into manifest.json files. */
function migrateRegistryMetadataToManifests(adaptersDir) {
  const registryPath = path.resolve(adaptersDir, 'registry.json');
  if (!fs.existsSync(registryPath)) {
    throw new Error(`registry.json not found at ${registryPath}`);
  }
  const registry = readJsonFile(registryPath);
  const manifestById = loadManifestById(adaptersDir);
  let updated = 0;

  for (const registryEntry of registry.adapters ?? []) {
    if (!registryEntry?.id) continue;
    const record = manifestById.get(registryEntry.id);
    if (!record) {
      console.warn(`[adapter-registry-sync] WARNING: manifest missing for ${registryEntry.id}, skipping migration.`);
      continue;
    }
    const merged = mergeRegistryEntryIntoManifest(record.manifest, registryEntry);
    if (JSON.stringify(merged) === JSON.stringify(record.manifest)) continue;
    writeJsonFile(record.manifestPath, merged);
    updated += 1;
  }

  return { updated, total: (registry.adapters ?? []).length };
}

/** Regenerate extension/adapters/registry.json from manifest.json files. */
function syncRegistryFromManifests(adaptersDir, { defaultIcon = DEFAULT_ICON } = {}) {
  const manifestById = loadManifestById(adaptersDir);
  const registry = buildRegistryFromManifests(
    [...manifestById.values()].map(({ manifest }) => manifest),
    { defaultIcon },
  );
  const registryPath = path.resolve(adaptersDir, 'registry.json');
  writeJsonFile(registryPath, registry);
  return { registryPath, adapterCount: registry.adapters.length };
}

module.exports = {
  DEFAULT_ICON,
  REGISTRY_METADATA_FIELDS,
  buildRegistryFromManifests,
  loadManifestById,
  migrateRegistryMetadataToManifests,
  syncRegistryFromManifests,
};
