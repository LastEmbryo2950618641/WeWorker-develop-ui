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
