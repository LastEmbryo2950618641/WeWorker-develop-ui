'use strict';

const fs = require('fs');
const path = require('path');

function unique(values) {
  return [...new Set(values)];
}

function applyListOverlay(base, overlay = {}) {
  const removed = new Set(overlay.remove ?? []);
  return unique([...(base ?? []), ...(overlay.add ?? [])])
    .filter((value) => !removed.has(value));
}

function validateStringList(value, field) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`"${field}" must be a string array`);
  }
}

function validateListOverlay(value, field) {
  if (value === undefined) return;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`"${field}" must be an object`);
  }
  validateStringList(value.add, `${field}.add`);
  validateStringList(value.remove, `${field}.remove`);
}

function validateBuildOverlay(overlay) {
  if (overlay === null || typeof overlay !== 'object' || Array.isArray(overlay)) {
    throw new Error('build overlay must be a JSON object');
  }

  if (overlay.name !== undefined && typeof overlay.name !== 'string') {
    throw new Error('"name" must be a string');
  }
  validateListOverlay(overlay.adapters, 'adapters');

  if (overlay.providers !== undefined) {
    if (overlay.providers === null || typeof overlay.providers !== 'object' || Array.isArray(overlay.providers)) {
      throw new Error('"providers" must be an object');
    }
    validateStringList(overlay.providers.remove, 'providers.remove');
    if (overlay.providers.upsert !== undefined && !Array.isArray(overlay.providers.upsert)) {
      throw new Error('"providers.upsert" must be an array');
    }
  }

  if (overlay.defaultProvider !== undefined && typeof overlay.defaultProvider !== 'string') {
    throw new Error('"defaultProvider" must be a string');
  }

  if (overlay.extension !== undefined) {
    if (overlay.extension === null || typeof overlay.extension !== 'object' || Array.isArray(overlay.extension)) {
      throw new Error('"extension" must be an object');
    }
    validateListOverlay(overlay.extension.permissions, 'extension.permissions');
    validateListOverlay(overlay.extension.matches, 'extension.matches');
    validateListOverlay(overlay.extension.hostPermissions, 'extension.hostPermissions');
    validateListOverlay(overlay.extension.contentScriptMatches, 'extension.contentScriptMatches');
    validateListOverlay(overlay.extension.webAccessibleResourceMatches, 'extension.webAccessibleResourceMatches');
    if (overlay.extension.actionDefaultTitle !== undefined && typeof overlay.extension.actionDefaultTitle !== 'string') {
      throw new Error('"extension.actionDefaultTitle" must be a string');
    }
  }
}

function mergeBuildProfile(base, overlay = {}) {
  validateBuildOverlay(overlay);
  const removedProviders = new Set(overlay.providers?.remove ?? []);
  const upserts = new Map((overlay.providers?.upsert ?? []).map((provider) => [provider.id, provider]));
  const providers = [];

  for (const provider of base.providers ?? []) {
    if (removedProviders.has(provider.id)) continue;
    providers.push(upserts.get(provider.id) ?? provider);
    upserts.delete(provider.id);
  }
  providers.push(...upserts.values());

  return {
    ...base,
    adapters: applyListOverlay(base.adapters, overlay.adapters),
    providers,
    defaultProvider: overlay.defaultProvider ?? base.defaultProvider,
  };
}

function mergeExtensionManifest(base, overlay = {}, version) {
  validateBuildOverlay({ extension: overlay });
  const manifest = structuredClone(base);
  manifest.version = version;
  manifest.permissions = applyListOverlay(manifest.permissions, overlay.permissions);
  manifest.host_permissions = applyListOverlay(
    applyListOverlay(manifest.host_permissions, overlay.matches),
    overlay.hostPermissions,
  );

  if (manifest.content_scripts?.[0]) {
    manifest.content_scripts[0].matches = applyListOverlay(
      applyListOverlay(manifest.content_scripts[0].matches, overlay.matches),
      overlay.contentScriptMatches,
    );
  }
  if (manifest.web_accessible_resources?.[0]) {
    manifest.web_accessible_resources[0].matches = applyListOverlay(
      applyListOverlay(manifest.web_accessible_resources[0].matches, overlay.matches),
      overlay.webAccessibleResourceMatches,
    );
  }
  if (overlay.actionDefaultTitle !== undefined) {
    manifest.action = { ...(manifest.action ?? {}), default_title: overlay.actionDefaultTitle };
  }
  return manifest;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`${label} not found at ${filePath}`);
    throw new Error(`Failed to read ${label} at ${filePath}: ${err.message}`);
  }
}

function parseBuildOptions(argv, env = process.env, cwd = process.cwd(), declaredProfile = 'public') {
  let profileName = env.WEWORKER_BUILD_PROFILE || declaredProfile || 'public';
  let overlayPath = env.WEWORKER_BUILD_OVERLAY || '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') profileName = argv[++index];
    else if (arg === '--overlay') overlayPath = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
    if (!argv[index]) throw new Error(`Missing value for ${arg}`);
  }

  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(profileName)) {
    throw new Error(`Invalid profile name: ${profileName}`);
  }
  if (!overlayPath && declaredProfile && profileName !== declaredProfile) {
    throw new Error(`Profile "${profileName}" does not match build-profile.json profile "${declaredProfile}"`);
  }

  return {
    profileName,
    overlayPath: overlayPath ? path.resolve(cwd, overlayPath) : null,
  };
}

module.exports = {
  applyListOverlay,
  mergeBuildProfile,
  mergeExtensionManifest,
  parseBuildOptions,
  readJson,
  validateBuildOverlay,
};
