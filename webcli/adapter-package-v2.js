/** Compatibility API: all v2 consumers resolve the same effective catalog. */
import { resolveBuiltinAdaptersDir } from './paths.js';
import { buildAdapterCatalog, resolveCatalogTool } from './adapter-catalog.js';
export { validateV2Manifest, validateV2AdapterDir } from './adapter-package-validation.js';

export function resolveV2AdaptersDir(webcliDir = null) {
  return resolveBuiltinAdaptersDir(webcliDir ? { baseDir: webcliDir } : {});
}

export function loadV2Adapters(options = {}) {
  return buildAdapterCatalog(options).effective;
}

export function findV2Adapter(adapterName, options = {}) {
  return loadV2Adapters(options).find((adapter) => adapter.name === adapterName) || null;
}

export function resolveV2Tool(toolName, options = {}) {
  if (typeof toolName !== 'string' || !toolName.includes('.')) return null;
  return resolveCatalogTool(toolName, options);
}
