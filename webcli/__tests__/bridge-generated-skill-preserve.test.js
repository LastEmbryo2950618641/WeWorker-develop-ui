import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../..');

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('bridge AI adapter generation compatibility', () => {
  it('routes legacy AI generation to a task without rewriting package-local Skills', () => {
    const source = readText('webcli/bridge.js');
    const start = source.indexOf('  async _handleGenerateAdapterWithAI(');
    const handler = source.slice(start, source.indexOf('  _send(', start));
    expect(handler).toContain('this._handleStartGenerationRun');
    expect(handler).not.toContain('writeFileSync');
    expect(handler).not.toContain('generateSkillMd');
  });

  it('restricts extension adapter writes to generated adapter artifacts', () => {
    const source = readText('webcli/bridge.js');

    expect(source).toContain('ADAPTER_ROOT_WRITABLE_FILES');
    expect(source).toContain("'SKILL.md'");
    expect(source).toContain("'SKILL.generated.md'");
    expect(source).toContain("'WEBCLI_KNOWLEDGE.md'");
    expect(source).toContain("'WEBCLI_KNOWLEDGE.json'");
    expect(source).toContain('GENERATED_WRITABLE_FILE_RE');
    expect(source).toContain('Adapter file is not writable from extension');
  });
});
