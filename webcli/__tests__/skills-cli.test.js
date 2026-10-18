import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listBundledSkills, readBundledSkill } from '../skills-cli.js';
const roots = [], cli = fileURLToPath(new URL('../index.js', import.meta.url));
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webcli-skills-test-')); roots.push(root);
  fs.mkdirSync(path.join(root, 'example/references'), { recursive: true });
  fs.writeFileSync(path.join(root, 'example/SKILL.md'), '---\nname: example\nversion: 1.0.0\ndescription: "Public example"\n---\n\n# Example\n');
  fs.writeFileSync(path.join(root, 'example/references/example.md'), 'Public reference without final newline');
  return root;
}
it('lists metadata and reads root/reference resources byte-for-byte without execution', () => {
  const root = fixture();
  expect(listBundledSkills(root)).toEqual([{ name: 'example', description: 'Public example', version: '1.0.0', path: 'example/SKILL.md' }]);
  expect(readBundledSkill('example', undefined, root).content).toContain('# Example');
  expect(readBundledSkill('example/references/example.md', undefined, root)).toEqual(readBundledSkill('example', 'references/example.md', root));
  expect(readBundledSkill('example', 'references/example.md', root).content).toBe('Public reference without final newline');
  const file = path.join(root, 'example/SKILL.md'), content = '\uFEFF' + fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, content);
  expect(readBundledSkill('example', undefined, root).content).toBe(content);
  expect(listBundledSkills(root)[0].description).toBe('Public example');
});
it('rejects traversal, absolute paths, links, non-files and excessive resources', () => {
  const root = fixture(); fs.symlinkSync(path.join(root, 'example'), path.join(root, 'linked'));
  fs.symlinkSync('/etc/hosts', path.join(root, 'example/reference.md'));
  fs.writeFileSync(path.join(root, 'example/large.md'), 'x'.repeat(512001));
  for (const target of ['../example', '/example', 'example/../example/SKILL.md', 'example//SKILL.md', 'example\\SKILL.md', 'example/./SKILL.md', 'example\0', 'linked', 'example/reference.md', 'example/references', 'example/large.md']) {
    expect(() => readBundledSkill(target, undefined, root)).toThrow();
  }
  expect(() => readBundledSkill('example/SKILL.md', 'other.md', root)).toThrow();
  expect(listBundledSkills(root).map(item => item.name)).toEqual(['example']);
});
it('runs actual CLI list/read/help with formats and rejects invalid input before any Bridge connection', () => {
  const run = args => execFileSync(process.execPath, [cli, 'skills', ...args], { encoding: 'utf8' });
  const listing = JSON.parse(run(['list', '--output-format=json']));
  expect(listing.map(item => item.name)).toContain('webcli-api-exploration');
  const skill = JSON.parse(run(['read', 'webcli-api-exploration', '--json']));
  expect(run(['read', 'webcli-api-exploration'])).toBe(skill.content);
  expect(run(['read', 'webcli-api-exploration', '--output-format=yaml'])).toContain('"skill": "webcli-api-exploration"');
  expect(JSON.parse(run(['--help'])).commands).toEqual(['list', 'read']);
  for (const args of [['read', '../example'], ['list', '--unknown'], ['read'], ['read', 'example', 'a', 'b']]) {
    const result = spawnSync(process.execPath, [cli, 'skills', ...args], { encoding: 'utf8' });
    expect(result.status).toBe(1); expect(result.stdout).toBe(''); expect(result.stderr).not.toContain('Bridge not running');
  }
});
