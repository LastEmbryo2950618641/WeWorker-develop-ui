import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
it('maps canonical/alias names while keeping type drift, unknown names and unmapped sites unverified', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-map-'));
  const write = (file, value) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value)); };
  try {
    write('upstream/package.json', { name: 'public-example', version: '1.0.0' });
    write('upstream/cli-manifest.json', [
      { site: 'example', name: 'lookup', sourceFile: 'example/read.js', access: 'read', args: [{ name: 'id', type: 'int', required: true }] },
      { site: 'example', name: 'other', sourceFile: 'example/read.js', args: [] },
      { site: 'missing', name: 'lookup', args: [] },
    ]);
    write('upstream/clis/example/read.js', 'throw new Error("do not execute")');
    write('repo/docs/opencli_clis_alignment_map.json', { source_commit: 'example', sites: [{ site: 'example', package: 'example.com' }, { site: 'missing', package: null }] });
    write('repo/adapters/example.com/manifest.json', { name: 'example.com', commands: [{ id: 'read', aliases: ['lookup'], runtime: 'extension', module: 'extension/commands/read.js', safety: 'read', schema: { properties: { id: { type: 'string' } }, required: ['id'] } }] });
    write('repo/adapters/example.com/extension/commands/read.js', 'throw new Error("do not execute")');
    const output = path.join(root, 'report.json');
    execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/audit-opencli-command-map.mjs', import.meta.url)), '--repo=' + path.join(root, 'repo'), '--upstream=' + path.join(root, 'upstream'), '--output=' + output]);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    expect(report.summary).toMatchObject({ upstreamCommands: 3, upstreamGroups: 2, verifiedByThisAudit: 0 });
    expect(report.commands.map(row => row.status)).toEqual(['named_candidate_needs_behavior_audit', 'package_present_no_named_candidate', 'no_mapped_package']);
    expect(report.commands[0].arguments[0].type).toBe('int');
    expect(report.commands[0].candidates[0].arguments[0].type).toBe('string');
    expect(report.commands[0].sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.commands.every(row => row.behavioralEvidence === null)).toBe(true);
    expect(JSON.stringify(report)).not.toContain(root);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
