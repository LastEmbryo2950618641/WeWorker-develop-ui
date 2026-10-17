import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreviewRuntimeValidator } from '../generation-harness/index.js';

const tmpDirs = [];

function makeTmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

describe('preview runtime validator', () => {
  it.each([false, true])('sends an inline preview bundle with requested-tool scope %s', async (restrictToExpectedTools) => {
    const draftAdapterDir = makeTmpDir('webcli-preview-draft-');
    fs.mkdirSync(path.join(draftAdapterDir, 'support'), { recursive: true });
    fs.writeFileSync(path.join(draftAdapterDir, 'support', 'runtime.js'), 'window.previewRuntimeLoaded = true;');
    fs.writeFileSync(
      path.join(draftAdapterDir, 'index.js'),
      'if (!window.previewRuntimeLoaded) throw new Error("support not loaded"); window.__webmcpRegister({ tools: [] });',
    );
    fs.writeFileSync(path.join(draftAdapterDir, 'manifest.json'), JSON.stringify({
      id: 'example.test',
      match: ['example.test'],
      support_files: ['support/runtime.js'],
    }));
    const setArtifact = vi.fn();
    const requestExtension = vi.fn(async (message) => {
      expect(message.previewBundle.manifest.id).toBe('example.test');
      expect(message.previewBundle.scripts).toEqual([
        { path: 'support/runtime.js', source: 'window.previewRuntimeLoaded = true;' },
        { path: 'index.js', source: 'if (!window.previewRuntimeLoaded) throw new Error("support not loaded"); window.__webmcpRegister({ tools: [] });' },
      ]);
      const previewWindow = { __webmcpRegister: vi.fn() };
      for (const script of message.previewBundle.scripts) {
        new Function('window', script.source)(previewWindow);
      }
      expect(previewWindow.__webmcpRegister).toHaveBeenCalledWith({ tools: [] });
      if (!message.testCases) {
        return {
          passed: true,
          phase: 'registration',
          tools: [{
            name: 'example.test.search_records',
            description: '查询记录',
            parameters: { type: 'object', properties: {}, required: [] },
          }, {
            name: 'example.test.check-login-status',
            parameters: { type: 'object', properties: {}, required: [] },
          }],
        };
      }
      return {
        passed: true,
        phase: 'execution',
        tools: [],
        toolResults: [{ toolName: 'example.test.search_records', attempted: true, passed: true }],
      };
    });
    const validator = createPreviewRuntimeValidator({ requestExtension, restrictToExpectedTools });
    const result = await validator({
      run: {
        id: 'run-123',
        snapshot: { siteKey: 'example.test', input: { tabId: 42 } },
        setArtifact,
      },
      draft: { adapterDir: draftAdapterDir, toolNames: ['example.test.search_records'] },
      plan: {
        tools: [{ name: 'example.test.search_records', risk: 'read', purpose: '查询记录' }],
      },
      memory: {
        listApiCandidates: [{
          url: 'https://example.test/api/search',
          responsePreview: '{"data":{"records":[]}}',
        }],
      },
      signal: new AbortController().signal,
    });

    expect(result.passed).toBe(true);
    expect(requestExtension).toHaveBeenCalledTimes(2);
    const previewAdapterId = requestExtension.mock.calls[0][0].previewAdapterId;
    expect(previewAdapterId).toMatch(/^generation_preview_/);
    expect(requestExtension.mock.calls[0][0]).toMatchObject({
      siteKey: 'example.test',
      tabId: 42,
      expectedToolNames: ['example.test.search_records'],
      previewBundle: {
        manifest: { id: 'example.test', match: ['example.test'], support_files: ['support/runtime.js'] },
      },
    });
    expect(requestExtension.mock.calls[1][0].testCases[0]).toMatchObject({
      toolName: 'example.test.search_records',
      execute: true,
      risk: { level: 'read' },
    });
    expect(requestExtension.mock.calls[1][0].testCases).toHaveLength(restrictToExpectedTools ? 1 : 2);
  });
});
