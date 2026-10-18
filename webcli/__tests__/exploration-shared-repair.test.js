import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveAdapterPaths } from '../paths.js';
import { readPackageDirectory, writePackageDirectory } from '../adapter-package-files.js';
import { writeRepairDraft } from '../exploration-repair.js';
import { verifyRepairRetention } from '../generation-harness/existing-site.js';
import { buildApiSourceEvidence, buildRuntimeTestCases } from '../generation-harness/index.js';
import { applyVerificationCases } from '../exploration-verification.js';
const roots = [];
it('only enables a repaired login utility when fresh read evidence and authored assertions both exist', () => {
  const name = 'example.com.check-login-status';
  const candidate = { url: 'https://example.com/items', method: 'GET', responsePreview: '{"title":"Example"}' };
  const source = buildApiSourceEvidence(candidate, { sourceKind: 'passive_list' });
  const input = { registeredTools: [{ name, generationSource: source, parameters: { type: 'object', properties: {} } }],
    memory: { listApiCandidates: [candidate] }, plan: { tools: [{ name, risk: 'read' }] } };
  const cases = { [name]: [{ id: 'public-page', args: {}, expect: { equals: { logged_in: true } } }] };
  expect(applyVerificationCases(buildRuntimeTestCases(input), cases)[0].execute).toBe(false);
  const selected = { ...input, repairedToolNames: [name] };
  expect(buildRuntimeTestCases(selected)[0].execute).toBe(false);
  expect(applyVerificationCases(buildRuntimeTestCases(selected), cases)[0].execute).toBe(true);
  expect(applyVerificationCases(buildRuntimeTestCases({ ...selected, memory: {} }), cases)[0].execute).toBe(false);
  expect(applyVerificationCases(buildRuntimeTestCases({ ...selected, registeredTools: [{ name }] }), cases)[0].execute).toBe(false);
  expect(applyVerificationCases(buildRuntimeTestCases({ ...selected, registeredTools: [{ name, generationSource: { ...source, fingerprint: 'different' } }] }), cases)[0].execute).toBe(false);
  expect(applyVerificationCases(buildRuntimeTestCases({ ...selected, plan: { tools: [{ name, risk: 'write' }] }, registeredTools: [{ name }] }), cases)[0].execute).toBe(false);
});
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-repair-')); roots.push(root);
  const paths = resolveAdapterPaths({ home: root, env: { WEWORKER_BUILD_PROFILE: 'public', WEWORKER_BUILTIN_ADAPTERS_DIR: path.join(root, 'builtin') } });
  const site = 'example.com', sharedFile = 'http/internal/map.js';
  const commands = ['first', 'second'].map(id => ({ id, description: 'Read public fixture', runtime: 'http', module: `http/commands/${id}.js`, safety: 'read',
    schema: { type: 'object', properties: {} }, http: { version: 1, strategy: 'PUBLIC_API', origins: ['https://example.com'] } }));
  const files = new Map([['manifest.json', JSON.stringify({ schema_version: 2, name: site, version: '1.0.0', description: 'Public shared example', commands })],
    ...commands.map(command => [command.module, 'module.exports = () => require("../internal/map.js")({title:"Example"});']),
    [sharedFile, 'module.exports = value => ({title:value.title});'], ['http/internal/protected.json', '{"public":true}']]);
  const pkg = writePackageDirectory(path.join(paths.builtinDir, site), files);
  const plan = { tools: commands.map(command => ({ name: command.id, risk: 'read', strategy: 'PUBLIC_API', sourceApiKind: 'list', sourceApiIndexes: [0] })) };
  const args = { site, paths, expectedDigest: pkg.digest, plan, memory: { siteKey: site, siteOrigin: 'https://example.com', generationBaseline: { digest: pkg.digest } },
    candidates: [{ url: 'https://example.com/items', method: 'GET', status: 200, responseSchema: { type: 'object' } }], outputRoot: path.join(root, 'draft'), sharedFiles: [sharedFile] };
  return { root, pkg, args, sharedFile };
}
it('binds named shared files to service scope and requires the complete command set', () => {
  const f = setup();
  const incomplete = { ...f.args, plan: { tools: f.args.plan.tools.slice(0, 1) } };
  expect(() => writeRepairDraft(incomplete)).toThrow(/every package command/);
  expect(fs.existsSync(f.args.outputRoot)).toBe(false);
  const prepared = writeRepairDraft(f.args);
  expect(prepared.scope).toMatchObject({ sharedFiles: [f.sharedFile], impact: 'all-package-commands', commandIds: ['first', 'second'] });
  expect(prepared.draft.toolNames).toEqual(['example.com.first', 'example.com.second']);
  expect(prepared.editableFiles).toContain(f.sharedFile);
  fs.writeFileSync(path.join(prepared.draft.adapterDir, f.sharedFile), 'module.exports = value => ({title:value.label});');
  expect([...verifyRepairRetention(f.pkg, readPackageDirectory(prepared.draft.adapterDir), prepared.scope)]).toEqual([]);
  const partialScope = { ...prepared.scope, commandIds: ['first'] };
  expect(() => verifyRepairRetention(f.pkg, readPackageDirectory(prepared.draft.adapterDir), partialScope)).toThrow(/scope|preserve/i);
  expect(() => verifyRepairRetention(f.pkg, readPackageDirectory(prepared.draft.adapterDir), { ...prepared.scope, impact: 'author-selected' })).toThrow();
});
it('rejects oversized and non-text shared files at selection and again at verification', () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.from('public\0example'), Buffer.alloc(250001, 97)]) {
    const f = setup();
    fs.writeFileSync(path.join(f.args.paths.builtinDir, f.args.site, f.sharedFile), bytes);
    const current = readPackageDirectory(path.join(f.args.paths.builtinDir, f.args.site));
    expect(() => writeRepairDraft({ ...f.args, expectedDigest: current.digest,
      memory: { ...f.args.memory, generationBaseline: { digest: current.digest } } })).toThrow(/UTF-8/);
    const intact = setup(), prepared = writeRepairDraft(intact.args);
    fs.writeFileSync(path.join(prepared.draft.adapterDir, intact.sharedFile), bytes);
    expect(() => verifyRepairRetention(intact.pkg, readPackageDirectory(prepared.draft.adapterDir), prepared.scope)).toThrow();
  }
});
it('preserves every unlisted file and rejects author-provided scope claims, deletion and binary replacement', () => {
  const f = setup(), prepared = writeRepairDraft(f.args), directory = prepared.draft.adapterDir;
  fs.writeFileSync(path.join(directory, 'http/internal/protected.json'), '{"public":false}');
  expect(() => verifyRepairRetention(f.pkg, readPackageDirectory(directory), prepared.scope)).toThrow();
  fs.writeFileSync(path.join(directory, 'http/internal/protected.json'), '{"public":true}');
  fs.writeFileSync(path.join(directory, f.sharedFile), Buffer.from([255, 0]));
  expect(() => verifyRepairRetention(f.pkg, readPackageDirectory(directory), prepared.scope)).toThrow();
  fs.writeFileSync(path.join(directory, f.sharedFile), 'module.exports = () => ({});');
  expect(() => verifyRepairRetention(f.pkg, readPackageDirectory(directory), { ...prepared.scope, sharedFiles: undefined })).toThrow();
  const dropped = readPackageDirectory(directory); dropped.files.delete(f.sharedFile);
  expect(() => verifyRepairRetention(f.pkg, dropped, prepared.scope)).toThrow();
});
it('rejects non-array, duplicate, missing, non-internal and traversal selections before creating a draft', () => {
  for (const sharedFiles of ['http/internal/map.js', ['http/internal/map.js', 'http/internal/map.js'], ['http/internal/missing.js'], ['manifest.json'], ['http/commands/first.js'], ['http/internal/../commands/first.js']]) {
    const f = setup(); expect(() => writeRepairDraft({ ...f.args, sharedFiles })).toThrow(/unique existing/);
    expect(fs.existsSync(f.args.outputRoot)).toBe(false);
  }
});
