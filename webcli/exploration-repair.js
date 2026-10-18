import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { buildAdapterCatalog } from './adapter-catalog.js';
import { assertManagedDirectory, assertManagedFile, readPackageDirectory, writePackageDirectory } from './adapter-package-files.js';
import { explorationError as fail, textArg } from './exploration-commands.js';
import { generationEvidenceDir } from './generation-harness/package-draft.js';
import { buildApiSourceEvidence } from './generation-harness/source-evidence.js';
import { verifyRepairRetention } from './generation-harness/existing-site.js';
import { pageSourceEvidence } from './exploration-page.js';
import { isHttpStrategy, httpToolContract } from './exploration-http.js';
import { buildExtensionWriteTool } from './exploration-extension-write.js';
import { buildUiWriteTool } from './exploration-ui-write.js';

export function repairTarget(site, paths) {
  textArg(site, 'site', 128);
  const catalog = buildAdapterCatalog({ paths });
  if (catalog.diagnostics.some(item => !item.name || item.name === site)) throw fail('ADAPTER_CATALOG_REVIEW_REQUIRED', 'Resolve Adapter catalog conflicts before repair.');
  const target = catalog.effective.find(item => item.name === site);
  if (!target) throw fail('ADAPTER_NOT_FOUND', 'Select an active installed Adapter.');
  if (target.commands.some(item => !['extension', 'http'].includes(item.runtime))) throw fail('REPAIR_RUNTIME_UNSUPPORTED', 'This repair workflow supports Extension and HTTP packages.');
  return { target, pkg: readPackageDirectory(target.root) };
}

export function writeRepairDraft({ site, expectedDigest, plan, memory, candidates, outputRoot, paths }) {
  const { target, pkg } = repairTarget(site, paths);
  if (pkg.digest !== expectedDigest || memory.generationBaseline?.digest !== expectedDigest || memory.siteKey !== site) throw fail('ADAPTER_BASE_CHANGED', 'Read repair-info and collect current evidence before repairing this Adapter.');
  const commandIds = plan.tools.map(tool => tool.name);
  const pageWriteContracts = {};
  for (const tool of plan.tools) {
    const command = pkg.commands.find(item => item.id === tool.name);
    if (!command || command.safety !== tool.risk) throw fail('REPAIR_SCOPE_CHANGED', 'Repair must preserve the selected command and its read/write safety.');
    if (command?.runtime === 'http' ? command.http.strategy !== tool.strategy : isHttpStrategy(tool.strategy)) throw fail('REPAIR_RUNTIME_MISMATCH', 'Repair must preserve the installed command runtime and strategy.');
    if (tool.risk === 'write') {
      if (command.runtime === 'http') {
        if (!isDeepStrictEqual(command.http, httpToolContract(tool, candidates[tool.sourceApiIndexes[0]]))) throw fail('REPAIR_RUNTIME_MISMATCH', 'HTTP write repair must preserve the exact installed origin and authentication contract.');
      } else {
        const key = tool.strategy === 'UI_SELECTOR' ? 'uiWrite' : tool.strategy === 'PAGE_FETCH' ? 'pageWrite' : null;
        if (!key || !command[key]) throw fail('REPAIR_RUNTIME_MISMATCH', 'Page write repair must preserve the installed declarative strategy.');
        const built = (key === 'uiWrite' ? buildUiWriteTool : buildExtensionWriteTool)(site, tool, candidates[tool.sourceApiIndexes[0]], memory.siteOrigin).toolDefinition;
        pageWriteContracts[command.id] = { pageRoute: built.pageRoute, [key]: built[key] };
      }
    }
  }
  const writeCommandIds = plan.tools.filter(tool => tool.risk === 'write').map(tool => tool.name);
  const scope = { name: site, digest: pkg.digest, commandIds, ...(writeCommandIds.length ? { writeCommandIds } : {}),
    ...(Object.keys(pageWriteContracts).length ? { pageWriteContracts } : {}) };
  const manifest = { ...pkg.manifest, version: pkg.manifest.version.replace(/^(\d+)\.(\d+)\.(\d+).*$/, (_m, a, b, c) => `${a}.${b}.${Number(c) + 1}`) };
  manifest.commands = manifest.commands.map(command => {
    const contract = pageWriteContracts[command.id];
    if (!contract) return command;
    const tool = plan.tools.find(item => item.name === command.id);
    const built = (command.uiWrite ? buildUiWriteTool : buildExtensionWriteTool)(site, tool, candidates[tool.sourceApiIndexes[0]], memory.siteOrigin).toolDefinition;
    return { ...command, ...contract, schema: built.parameters, description: tool.purpose || command.description };
  });
  const files = new Map(pkg.files);
  files.set('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  verifyRepairRetention(pkg, { ...pkg, files, manifest }, scope);
  const adapterDir = path.join(outputRoot, site);
  assertManagedDirectory(outputRoot);
  assertManagedFile(outputRoot, site);
  if (fs.existsSync(adapterDir)) throw fail('DRAFT_EXISTS', 'Repair requires a new isolated directory.');
  writePackageDirectory(adapterDir, files);
  const evidence = { format: 2, name: site, retainedPackage: { name: site, digest: pkg.digest },
    commands: Object.fromEntries(plan.tools.map(tool => [tool.name, { originalName: `${site}.${tool.name}`, safety: tool.risk,
      generationSource: tool.sourcePageId ? pageSourceEvidence(memory.pageSources.find(item => item.id === tool.sourcePageId))
        : tool.risk === 'write' ? { ...buildApiSourceEvidence(candidates[tool.sourceApiIndexes[0]], { sourceKind: candidates[tool.sourceApiIndexes[0]].declared ? 'authored_write_declaration' : 'observed_write' }), risk: { level: 'write', confidence: 1 } }
          : candidates[tool.sourceApiIndexes[0]].sourceEvidence || buildApiSourceEvidence(candidates[tool.sourceApiIndexes[0]], { sourceKind: 'passive_list' }) }])) };
  const evidenceDir = generationEvidenceDir(adapterDir);
  assertManagedDirectory(evidenceDir);
  fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(assertManagedFile(evidenceDir, 'source.json'), JSON.stringify(evidence), { flag: 'wx', mode: 0o600 });
  return { scope, editableFiles: ['manifest.json', ...pkg.manifest.commands.filter(item => commandIds.includes(item.id)).map(item => item.module)],
    draft: { packageFormat: 2, siteKey: site, adapterDir, mode: 'scoped_repair', toolNames: commandIds.map(id => `${site}.${id}`),
      managedBaseline: { profile: paths.profile, name: site, digest: pkg.digest, source: target.source } } };
}
