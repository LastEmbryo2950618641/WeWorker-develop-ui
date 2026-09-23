import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertAdapterIdentity, buildAdapterCatalog } from '../adapter-catalog.js';
import { assertManagedDirectory, assertManagedFile, validatePackageFiles, writePackageDirectory } from '../adapter-package-files.js';
import { resolveAdapterPaths } from '../paths.js';

export function draftCommandId(name) {
  const id = String(name).replace(/_/g, '-');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Generated command requires a portable kebab-case identity.');
  return id;
}

export function generationEvidenceDir(adapterDir) {
  return path.join(path.dirname(path.resolve(adapterDir)), '.generation', path.basename(adapterDir));
}

export function resolveGeneratedPackageRoot(outputRoot) {
  return outputRoot || path.join(resolveAdapterPaths().workspaceDir, randomUUID());
}

/** Writes executable content and task evidence to separate sibling directories. */
export function writePackageDraft({ memory, adapterDir, supportBundle, paths }) {
  const name = assertAdapterIdentity(memory.siteKey);
  const root = path.resolve(adapterDir);
  assertManagedDirectory(path.dirname(root));
  assertManagedFile(path.dirname(root), name);
  if (fs.existsSync(root) && fs.readdirSync(root).length) throw new Error('Generation requires an empty isolated draft directory.');
  const catalog = buildAdapterCatalog(paths ? { paths } : {});
  if (catalog.diagnostics.some(entry => !entry.name && !entry.names)) throw new Error('Adapter catalog requires inspection before generation.');
  const base = catalog.effective.find(entry => entry.name === name);
  const version = base ? base.version.replace(/^(\d+)\.(\d+)\.(\d+).*$/, (_match, major, minor, patch) => `${major}.${minor}.${Number(patch) + 1}`) : '1.0.0';
  const evidence = { format: 2, name, commands: {} };
  const files = new Map([['extension/internal/runtime.js', supportBundle.sharedRuntime.content]]);
  const commands = supportBundle.toolFiles.map(file => {
    const tool = file.toolDefinition;
    if (!tool?.name?.startsWith(name + '.') || !file.v2Content) throw new Error('Generated command has no package definition.');
    const local = tool.name.slice(name.length + 1), id = draftCommandId(local);
    const module = `extension/commands/${id}.js`;
    files.set(module, file.v2Content);
    // Evidence belongs to the generation task; it never participates in package installation.
    evidence.commands[id] = { originalName: tool.name, safety: tool.access === 'write' ? 'write' : 'read', generationSource: tool.generationSource || null };
    return { id, ...(local !== id ? { aliases: [local] } : {}), runtime: 'extension', module,
      description: tool.description, schema: tool.parameters, safety: tool.access === 'write' ? 'write' : 'read',
    };
  });
  const manifest = { schema_version: 2, name, version, description: memory.scaffoldSemanticHints?.manifestDescription || `Adapter for ${name}`,
    match: [memory.siteHost || name], commands };
  // API origins are explicit package grants; only structurally reviewed source endpoints contribute.
  const hosts = new Set();
  for (const command of Object.values(evidence.commands)) {
    if (!command.generationSource?.endpoint) continue;
    try { hosts.add(new URL(command.generationSource.endpoint).hostname); } catch { /* Relative evidence has no extra origin. */ }
  }
  const extraHosts = [...hosts].filter(host => !manifest.match.includes(host));
  if (extraHosts.length) manifest.runtime_allowed_hosts = extraHosts.sort();
  files.set('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  const pkg = validatePackageFiles(files);
  const evidenceDir = generationEvidenceDir(root);
  assertManagedFile(path.dirname(root), `.generation/${name}/source.json`);
  assertManagedDirectory(evidenceDir);
  if (fs.existsSync(evidenceDir) && fs.readdirSync(evidenceDir).length) throw new Error('Generation evidence directory must be empty.');
  writePackageDirectory(root, files);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = assertManagedFile(evidenceDir, 'source.json');
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  return { packageFormat: 2, siteKey: name, adapterDir: root, generatedDir: path.join(root, 'extension/commands'),
    mode: 'isolated_package_draft', toolNames: pkg.commands.map(command => command.name),
    files: { manifest: path.join(root, 'manifest.json'), sharedRuntime: path.join(root, 'extension/internal/runtime.js'), sourceEvidence: evidencePath },
    managedBaseline: { profile: catalog.profile, name, digest: base?.digest || null, source: base?.source || null },
    supportFiles: [], manifestUpdated: true, indexCatalogUpdated: false, registryCatalogUpdated: false, removedGeneratedFiles: [] };
}
