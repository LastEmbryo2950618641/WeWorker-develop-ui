import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, it, expect } from 'vitest';
import { ExplorationKnowledge } from '../exploration-knowledge.js';
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function setup() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'example-knowledge-')); roots.push(root); return { root, store: new ExplorationKnowledge(root) }; }
it('persists structural knowledge with compare-and-swap updates and field conflict detection', () => {
  const { store, root } = setup();
  const first = store.read('example.com');
  expect(first.knowledge).toBeNull();
  const input = { expectedHash: first.hash, verifiedAt: new Date().toISOString(), packageDigest: 'example-digest', endpoints: [{ id: 'example-api', method: 'GET', url: 'https://example.com/api/list?q=%3Cvalue%3E' }], commands: {}, fields: { 'items.id': { meaning: 'Public item identifier', source: 'Observed UI link' } }, notes: 'Read-only example query.' };
  const saved = store.save('example.com', input);
  expect(saved.knowledge.fields['items.id'].meaning).toBe(input.fields['items.id'].meaning);
  expect(new ExplorationKnowledge(root).read('example.com').hash).toBe(saved.hash);
  expect(() => store.save('example.com', input)).toThrow(/Knowledge changed/);
  expect(() => store.save('example.com', { ...input, expectedHash: saved.hash, fields: { 'items.id': { meaning: 'Different meaning', source: 'Unverified' } } })).toThrow(/different knowledge/);
  expect(() => store.read('../escape')).toThrow();
});
it('marks old records and changed installed packages stale even after a newer knowledge save', () => {
  const { store } = setup(); const site = 'example.com';
  const past = new Date(Date.now() - 31 * 86400000).toISOString();
  store.save(site, { expectedHash: store.read(site).hash, verifiedAt: past, packageDigest: 'old', endpoints: [{ id: 'old-api' }], pages: [{ id: 'old-page' }], commands: { old: { verifiedAt: past } } });
  const newer = store.save(site, { expectedHash: store.read(site).hash, verifiedAt: new Date().toISOString(), packageDigest: 'new', endpoints: [{ id: 'new-api' }], commands: {} });
  expect(newer.staleEndpoints).toEqual(['old-api']); expect(newer.staleCommands).toEqual(['old']);
  expect(newer.stalePages).toEqual(['old-page']);
  expect(store.read(site, { activeDigest: 'different' }).staleReasons).toContain('installed_package_changed_or_unavailable');
});

function revisionFixture() {
  const { store, root } = setup(), site = 'example.com', verifiedAt = new Date().toISOString();
  const expected = { meaning: 'Public item identifier', source: 'Response id property' };
  const saved = store.save(site, { expectedHash: store.read(site).hash, verifiedAt, packageDigest: 'original', endpoints: [], commands: {}, fields: { id: expected } });
  const cases = [{ id: 'example-first', args: { id: '007' }, expect: { equals: { id: '007' } } }];
  const change = { field: 'id', expected, replacement: { meaning: 'Public item identifier', source: 'Verified response newId mapped to id' }, reason: 'The service renamed its response property', evidence: { tool: 'example.com.items', path: '$.id', caseIds: ['example-first'] } };
  const input = { expectedHash: saved.hash, verifiedAt, packageDigest: 'repaired', taskId: 'example-repair-task', endpoints: [],
    commands: { 'example.com.items': { verifiedAt, packageDigest: 'repaired', cases } }, revisions: [change] };
  return { store, root, site, saved, change, input };
}
it('explicitly revises mappings with CAS, complete history and current verified case hashes across restart', () => {
  const f = revisionFixture(), result = f.store.save(f.site, f.input);
  expect(result.knowledge.fields.id).toMatchObject(f.change.replacement);
  expect(result.knowledge.fieldRevisions).toEqual([expect.objectContaining({ revision: 1, field: 'id', reason: f.change.reason,
    previous: expect.objectContaining(f.change.expected), replacement: expect.objectContaining(f.change.replacement), previousKnowledgeHash: f.saved.hash,
    taskId: f.input.taskId, packageDigest: 'repaired', evidence: expect.objectContaining({ tool: 'example.com.items', kind: 'read_cases', path: '$.id', caseIds: ['example-first'], digest: expect.stringMatching(/^[a-f0-9]{64}$/) }) })]);
  expect(new ExplorationKnowledge(f.root).read(f.site).knowledge.fieldRevisions).toEqual(result.knowledge.fieldRevisions);
  expect(() => f.store.save(f.site, f.input)).toThrow(/Knowledge changed/);
  const additive = f.store.save(f.site, { ...f.input, expectedHash: result.hash, revisions: undefined, notes: 'Public follow-up' });
  expect(additive.knowledge.fieldRevisions).toEqual(result.knowledge.fieldRevisions);
});
it('rejects absent, stale, mismatched, duplicate and unsupported revision evidence without changing storage', () => {
  const f = revisionFixture();
  const invalid = [
    { revisions: [] }, { revisions: [null] }, { revisions: [f.change, f.change] }, { notes: 'mixed mutation' },
    { revisions: [{ ...f.change, expected: { ...f.change.expected, source: 'Wrong source' } }] },
    { revisions: [{ ...f.change, replacement: f.change.expected }] },
    { revisions: [{ ...f.change, evidence: { ...f.change.evidence, tool: 'example.com.other' } }] },
    { revisions: [{ ...f.change, evidence: { ...f.change.evidence, path: 'unverified' } }] },
    { revisions: [{ ...f.change, evidence: { ...f.change.evidence, caseIds: ['missing'] } }] },
    { revisions: [{ ...f.change, evidence: { ...f.change.evidence, caseIds: ['example-first', 'example-first'] } }] },
    { revisions: [{ ...f.change, authorization: 'not-permitted' }] }, { commands: {} }, { taskId: null },
    { verifiedAt: new Date(Date.now() - 31 * 86400000).toISOString() }, { verifiedAt: 'invalid' },
  ];
  for (const patch of invalid) {
    expect(() => f.store.save(f.site, { ...f.input, ...patch })).toThrow();
    expect(f.store.read(f.site).hash).toBe(f.saved.hash);
  }
});
it('write revisions require independent verified effects and keep only proof metadata in history', () => {
  const f = revisionFixture();
  const command = { packageDigest: 'repaired', writeVerification: { kind: 'ui_single_submit_v1', verifiedAt: f.input.verifiedAt,
    fixture: { id: 'example-write', representativeArgs: { id: '007' }, effect: { after: { equals: { id: '007' } } } } } };
  const input = { ...f.input, commands: { 'example.com.items': command }, revisions: [{ ...f.change, evidence: { tool: 'example.com.items', path: 'id' } }] };
  const bad = structuredClone(input); delete bad.commands['example.com.items'].writeVerification.verifiedAt;
  expect(() => f.store.save(f.site, bad)).toThrow(/independent effect/);
  const result = f.store.save(f.site, input), history = result.knowledge.fieldRevisions;
  expect(history[0].evidence).toMatchObject({ kind: 'ui_single_submit_v1', fixtureId: 'example-write' });
  expect(JSON.stringify(history)).not.toContain('007'); expect(JSON.stringify(history)).not.toContain('representativeArgs');
});
it('preserves every prior revision and refuses to silently trim a full history', () => {
  const f = revisionFixture();
  const knowledge = structuredClone(f.saved.knowledge); knowledge.fieldRevisions = Array.from({ length: 200 }, (_, i) => ({ revision: i + 1 }));
  fs.writeFileSync(f.store.file(f.site), JSON.stringify(knowledge));
  const before = f.store.read(f.site);
  expect(() => f.store.save(f.site, { ...f.input, expectedHash: before.hash })).toThrow(/history is full/);
  expect(f.store.read(f.site).hash).toBe(before.hash);
});
