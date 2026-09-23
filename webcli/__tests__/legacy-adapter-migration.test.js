import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCommands, migrateLegacyAdapter } from '../scripts/migrate-legacy-extension-adapters.cjs';
import { validateV2AdapterDir } from '../adapter-package-v2.js';

function createLegacy(root) {
  const source = join(root, 'legacy', 'demo.example.com');
  const generated = join(source, 'webcli-generated');
  mkdirSync(join(generated, 'shared'), { recursive: true });
  writeFileSync(join(generated, 'shared', 'runtime.generated.js'), `
    (function () {
      const support = window.__webmcpGeneratedSupport || (window.__webmcpGeneratedSupport = {});
      support['demo.example.com'] = { tools: [{
        name: 'demo.example.com.search_items',
        description: 'Search items',
        parameters: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] },
        handler: (args) => ({ keyword: args.keyword })
      }] };
    })();
  `);
  writeFileSync(join(source, 'index.js'), `
    window.__webmcpRegister({
      match: ['demo.example.com'],
      tools: [{
        name: 'demo.example.com.like_item',
        description: 'Like item',
        parameters: { type: 'object', properties: {}, required: [] },
        handler: () => ({ liked: true })
      }]
    });
  `);
  writeFileSync(join(source, 'manifest.json'), JSON.stringify({
    id: 'demo.example.com',
    version: '1.2.3',
    description: 'Demo adapter',
    match: ['demo.example.com'],
    requires_auth: true,
    support_files: ['webcli-generated/shared/runtime.generated.js'],
    author: 'fixture',
  }));
  return source;
}

describe('legacy Extension Adapter v2 migration', () => {
  it('merges legacy duplicate spellings into one canonical command', () => {
    const commands = buildCommands('demo.example.com', [
      { publicName: 'demo.example.com.search_items', name: 'demo.example.com.searchItems', description: 'Search', parameters: { type: 'object' } },
      { name: 'demo.example.com.searchItems', handlerName: 'demo.example.com.search_items', description: 'Search alias', parameters: { type: 'object' }, aliases: ['demo.example.com.find_items'] },
    ]);

    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe('search-items');
    expect(commands[0].aliases).toEqual(['search_items', 'searchItems', 'find_items']);
  });

  it('wraps preserved logic and emits a valid closed v2 package', () => {
    const root = mkdtempSync(join(tmpdir(), 'legacy-v2-migration-'));
    try {
      const source = createLegacy(root);
      const output = join(root, 'adapters');
      const result = migrateLegacyAdapter({ sourceDir: source, outputDir: output });
      const validated = validateV2AdapterDir(join(output, 'demo.example.com'));
      expect(validated.commands.map((command) => command.id)).toEqual(['like-item', 'search-items']);
      expect(validated.commands.find((command) => command.id === 'like-item')).toMatchObject({
        safety: 'write',
        aliases: ['like_item'],
      });
      expect(validated.commands.find((command) => command.id === 'search-items')).toMatchObject({
        safety: 'read',
        aliases: ['search_items'],
      });
      expect(readFileSync(join(result.destination, 'extension/internal/legacy.js'), 'utf8')).toContain('webcli-generated/shared/runtime.generated.js');
      expect(readFileSync(join(result.destination, 'extension/commands/search-items.js'), 'utf8'))
        .toContain('demo.example.com.search_items');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
