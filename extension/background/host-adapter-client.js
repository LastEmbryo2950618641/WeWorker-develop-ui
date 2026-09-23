import { v2CommandDef } from './v2-loader.js';

/** The desktop host owns selection. Legacy packaged assets remain a migration input. */
export function createHostAdapterClient(request) {
  const managedNames = new Set();
  let pending = null;
  async function catalog() {
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await request({ type: 'adapter_catalog' }, 10000);
        const result = response?.result;
        if (!response?.ok || !Array.isArray(result?.adapters) || !Array.isArray(result?.managedNames)) return null;
        for (const name of result.managedNames) managedNames.add(name);
        return result;
      } catch { return null; }
    })();
    try { return await pending; } finally { pending = null; }
  }
  return {
    catalog,
    async manifest(name) {
      const result = await catalog();
      if (result?.available === false) return { managed: true, manifest: null };
      return { managed: managedNames.has(name), manifest: result?.adapters.find((entry) => entry.name === name) || null };
    },
    async merge(legacy) {
      const result = await catalog();
      if (result?.available === false) return [];
      return [...legacy.filter((entry) => entry.schema_version !== 2 && !managedNames.has(entry.id)), ...(result?.adapters || [])];
    },
    async tools(legacy) {
      const result = await catalog();
      if (result?.available === false) return [];
      return [
        ...legacy.filter((tool) => ![...managedNames].some((name) => tool.adapterId === name || tool.name?.startsWith(name + '.'))),
        ...(result?.adapters || []).flatMap((manifest) => manifest.commands.filter((command) => command.runtime === 'extension').map((command) => v2CommandDef(manifest, command))),
      ];
    },
    async tool(toolName) {
      const result = await catalog();
      if (result?.available === false) throw new Error('Adapter catalog requires inspection before execution.');
      for (const manifest of result?.adapters || []) {
        const command = manifest.commands.find((entry) => entry.legacyNames?.includes(toolName));
        if (command) return { managed: true, manifest, command };
      }
      const name = [...managedNames].sort((a, b) => b.length - a.length).find((item) => toolName.startsWith(item + '.'));
      if (!name) return { managed: false };
      const manifest = result?.adapters.find((entry) => entry.name === name);
      const callId = toolName.slice(name.length + 1);
      const command = manifest?.commands.find((entry) => entry.id === callId || entry.aliases?.includes(callId));
      if (!manifest || !command) throw new Error('Selected Adapter command is unavailable; refresh the catalog.');
      return { managed: true, manifest, command };
    },
    async bundle(manifest) {
      const snapshot = manifest?._hostSnapshot;
      if (!snapshot) throw new Error('Adapter host snapshot unavailable.');
      const response = await request({ type: 'adapter_bundle', payload: {
        name: manifest.name, digest: snapshot.digest, profile: snapshot.profile,
      } }, 15000);
      const result = response?.result;
      if (!response?.ok || result?.name !== manifest.name || result?.digest !== snapshot.digest || result?.profile !== snapshot.profile) {
        throw new Error(response?.error || 'Adapter execution snapshot unavailable.');
      }
      return result;
    },
  };
}
