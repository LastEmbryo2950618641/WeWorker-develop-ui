// Static inventory only. Matching names are candidates, never behavioral proof.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(process.argv.find(arg => arg.startsWith('--repo='))?.slice(7) || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const upstream = process.argv.find(arg => arg.startsWith('--upstream='))?.slice(11);
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
if (!upstream || !output) throw new Error('Usage: node audit-opencli-command-map.mjs --upstream=<release package> --output=<report.json>');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await fs.readFile(path.join(upstream, 'cli-manifest.json'));
const commands = JSON.parse(manifestBytes);
const release = JSON.parse(await fs.readFile(path.join(upstream, 'package.json'), 'utf8'));
const historical = JSON.parse(await fs.readFile(path.join(repo, 'docs/opencli_clis_alignment_map.json'), 'utf8'));
const bySite = new Map(historical.sites.map(item => [item.site, item]));
const packages = new Map();
for (const item of await fs.readdir(path.join(repo, 'adapters'), { withFileTypes: true })) {
  if (!item.isDirectory()) continue;
  const filename = path.join(repo, 'adapters', item.name, 'manifest.json');
  try {
    const bytes = await fs.readFile(filename), manifest = JSON.parse(bytes);
    packages.set(item.name, { manifest, hash: hash(bytes), filename: 'adapters/' + item.name + '/manifest.json' });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const rows = [];
async function fileHash(root, relative) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) return null;
  try { return hash(await fs.readFile(path.join(root, relative))); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
for (const command of commands) {
  const history = bySite.get(command.site), pkg = packages.get(history?.package);
  const aliases = Array.isArray(command.aliases) ? command.aliases : [];
  const upstreamNames = new Set([command.name, ...aliases]);
  const candidates = (pkg?.manifest.commands || []).filter(local => [local.id, ...(local.aliases || [])].some(name => upstreamNames.has(name))
    || (local.legacyNames || []).some(name => upstreamNames.has(name.slice(command.site.length + 1)) && name.startsWith(command.site + '.')));
  const candidateRows = [];
  for (const local of candidates) {
    const module = 'adapters/' + pkg.manifest.name + '/' + local.module;
    candidateRows.push({ command: pkg.manifest.name + '.' + local.id, module, moduleSha256: await fileHash(repo, module),
      runtime: local.runtime, safety: local.safety || null, arguments: Object.entries(local.schema?.properties || {}).map(([name, value]) => ({ name, type: value.type || null, required: (local.schema?.required || []).includes(name) })) });
  }
  const sourceFile = command.sourceFile || command.modulePath || null;
  rows.push({ upstream: command.site + '/' + command.name, site: command.site, command: command.name,
    sourceFile, sourceSha256: await fileHash(path.join(upstream, 'clis'), sourceFile), access: command.access || null,
    arguments: (command.args || []).map(arg => ({ name: arg.name, type: arg.type || null, required: arg.required === true })),
    package: pkg?.manifest.name || null, historicalPackage: history?.package || null,
    status: !pkg ? 'no_mapped_package' : candidates.length ? 'named_candidate_needs_behavior_audit' : 'package_present_no_named_candidate',
    ...(pkg ? { manifest: pkg.filename, manifestSha256: pkg.hash } : {}),
    candidates: candidateRows,
    behavioralEvidence: null,
    historicalRecord: history?.migration_record || null });
}
const groups = [...new Set(commands.map(item => item.site))].sort();
const counts = {};
for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
const report = { baseline: { package: release.name, version: release.version, manifestSha256: hash(manifestBytes), historicalCommit: historical.source_commit },
  method: 'Exact command/alias names inside the historically mapped package; no command execution and no semantic equivalence inference.',
  limits: ['no_mapped_package means no package in the historical map, not proof that no equivalent exists elsewhere.', 'Unmatched names can still have differently named equivalents and require source audit.', 'Historical migration records are references, not current acceptance evidence.',
    'All rows retain behavioralEvidence:null until individual behavior and validation are reviewed.'],
  summary: { upstreamCommands: rows.length, upstreamGroups: groups.length, localPackages: packages.size, verifiedByThisAudit: 0, ...counts }, groups, commands: rows };
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report.summary));
