import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../..');

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('sidepanel generated skill UX', () => {
  it('keeps generation workflow behind the developer-mode unlock', () => {
    const html = readText('extension/sidepanel/sidepanel.html');
    const source = readText('extension/sidepanel/sidepanel.js');

    expect(html).toContain('data-panel="panelDev" data-dev-only hidden');
    expect(html).toContain('data-panel="panelConfig" data-dev-only hidden');
    expect(source).toContain("document.querySelectorAll('[data-dev-only]')");
    expect(source).toContain('el.hidden = !enabled');
    expect(html).toContain('id="devExploreSection"');
    expect(html).toContain('id="btnDevShowCode" hidden');
  });

  it('keeps legacy skill editing available while generation waits for local installation', () => {
    const source = readText('extension/sidepanel/sidepanel.js');

    expect(source).toContain('安装并启用');
    expect(source).toContain('installationReview');
    expect(source).toContain('open-skill');
    expect(source).toContain('open-generated-skill');
    expect(source).toContain("openDevEditorAtFile('skill')");
    expect(source).toContain("openDevEditorAtFile('generatedSkill')");
  });
});
