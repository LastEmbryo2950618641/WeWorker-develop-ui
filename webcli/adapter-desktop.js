import { buildAdapterCatalog } from './adapter-catalog.js';
import { selectAdapter } from './adapter-install-store.js';
import { resolveUserAdaptersDir, resolveAdapterPaths } from './paths.js';
import { managedAdapterViews } from './adapter-views.js';
import { syncManagedAdapterSkills } from './adapter-skill-sync.js';
export { isManagedAdapterSkillCurrent, createManagedAdapterSkillValidator } from './adapter-skill-sync.js';
export const resolveDesktopUserAdaptersDir = resolveUserAdaptersDir;

export function refreshDesktopAdapterSkills(target) {
  return syncManagedAdapterSkills({ target, snapshot: managedAdapterViews(), profile: resolveAdapterPaths().profile });
}

/** Inventory for management UIs; inactive packages never expose callable tools. */
export function describeDesktopAdapters(options = {}) {
  const catalog = buildAdapterCatalog(options);
  if (catalog.diagnostics.some((item) => !item.name && !item.names)) throw new Error('Adapter catalog requires inspection.');
  const names = new Set(catalog.candidates.filter((entry) => entry.source !== 'unmanaged').map((entry) => entry.name));
  for (const item of catalog.diagnostics) {
    if (item.source === 'unmanaged') continue;
    if (item.name) names.add(item.name);
    for (const name of item.names || []) names.add(name);
  }
  const adapters = [...names].sort().map((name) => {
    const active = catalog.effective.find((entry) => entry.name === name);
    const selection = catalog.selections[name];
    const source = selection?.source === 'disabled' ? selection.resumeSource : selection?.source || 'builtin';
    const candidate = active || catalog.candidates.find((entry) => entry.name === name && entry.source === source);
    return {
      ...(candidate?.manifest || {}), id: name, name,
      commands: active?.commands || [],
      managed: { enabled: !!active, profile: catalog.profile, source: candidate?.source || source || null,
        digest: candidate?.digest || null, version: candidate?.version || null,
        canEnable: !!candidate && selection?.source === 'disabled',
        diagnostics: catalog.diagnostics.filter((item) => item.name === name || item.names?.includes(name)).map((item) => item.code),
      },
    };
  });
  return { adapters, managedNames: names, revision: catalog.revision };
}

export function toggleDesktopAdapter(name, options = {}) {
  const entry = describeDesktopAdapters(options).adapters.find((adapter) => adapter.name === name);
  if (!entry) return null;
  if (!entry.managed.enabled && !entry.managed.canEnable) throw new Error('Adapter cannot be enabled; choose a valid source or repair its package.');
  selectAdapter(name, entry.managed.enabled ? 'disabled' : entry.managed.source, options);
  return !entry.managed.enabled;
}
