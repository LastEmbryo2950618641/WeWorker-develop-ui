import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GENERATION_HARNESS_VERSION,
  writeGenerationHarnessProvenance,
} from '../generation-harness/index.js';

const tmpDirs = [];

afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

describe('generation harness provenance', () => {
  it('writes a durable smart-generation marker into manifest.json', () => {
    const adapterDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcli-provenance-'));
    tmpDirs.push(adapterDir);
    const manifestPath = path.join(adapterDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ id: 'example.test', match: ['example.test'] }));
    const setArtifact = vi.fn();
    const provenance = writeGenerationHarnessProvenance({
      run: { id: 'run-123', snapshot: { revisionCount: 1 }, setArtifact },
      draft: { adapterDir, files: { manifest: manifestPath } },
      validation: { passed: true, validator: 'static-v1', checkedFiles: 5 },
      runtimeValidation: {
        passed: true,
        validator: 'runtime-v1',
        executionSummary: { attempted: 2, passed: 2, skipped: 1 },
      },
      plan: { tools: [{ name: 'a' }, { name: 'b' }] },
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(provenance.version).toBe(GENERATION_HARNESS_VERSION);
    expect(manifest.generation_harness).toMatchObject({
      version: GENERATION_HARNESS_VERSION,
      mode: 'smart',
      run_id: 'run-123',
      revision_count: 1,
      plan_tool_count: 2,
      runtime_validation: { attempted: 2, passed_tools: 2, skipped: 1 },
    });
    expect(setArtifact).toHaveBeenCalledWith('provenance', provenance);
  });

  it('does not strip provenance through old direct AI publication', () => {
    const bridgeSource = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'bridge.js'), 'utf8');
    expect(bridgeSource).not.toContain('function clearGenerationHarnessProvenance');
    expect(bridgeSource).not.toContain('clearGenerationHarnessProvenance(result.files?.manifest)');
    expect(bridgeSource).not.toContain('clearGenerationHarnessProvenance(manifestPath)');
  });
});
