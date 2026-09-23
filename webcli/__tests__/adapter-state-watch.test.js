import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchAdapterState } from '../adapter-state-watch.js';
import { writeAdapterState } from '../adapter-state.js';
import { installAdapter } from '../adapter-install-store.js';

function paths(root) {
  return { profile: 'public', stateDir: join(root, 'state') };
}

function state(revision, installations = Object.create(null), selections = Object.create(null)) {
  return {
    schemaVersion: 1,
    profile: 'public',
    revision,
    installations,
    selections,
    development: Object.create(null),
  };
}

describe('Adapter state watcher', () => {
  it('emits revision changes with changed Adapter identities', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adapter-state-watch-'));
    try {
      const stateDir = join(root, 'state');
      mkdirSync(stateDir, { recursive: true });
      const onEvent = vi.fn();
      const watcher = watchAdapterState(paths(root), onEvent, { intervalMs: 20 });
      await watcher.poll();
      expect(onEvent).not.toHaveBeenCalled();

      const installations = Object.create(null);
      installations['demo.example.com'] = { name: 'demo.example.com', digest: 'a'.repeat(64) };
      writeAdapterState(paths(root), state(1, installations));
      await watcher.poll();
      expect(onEvent).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'adapter_state_changed',
        profile: 'public',
        previousRevision: 0,
        revision: 1,
        adapters: ['demo.example.com'],
      }));

      const selections = Object.create(null);
      selections['demo.example.com'] = { source: 'disabled' };
      writeAdapterState(paths(root), state(2, installations, selections));
      await watcher.poll();
      expect(onEvent).toHaveBeenLastCalledWith(expect.objectContaining({
        previousRevision: 1,
        revision: 2,
        adapters: ['demo.example.com'],
      }));
      watcher.stop();
      expect(watcher.isStopped).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('observes committed packages from the unified installer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adapter-state-install-'));
    try {
      const adapterPaths = {
        profile: 'public',
        builtinDir: join(root, 'builtin'),
        userDir: join(root, 'user'),
        workspaceDir: join(root, 'workspaces'),
        stateDir: join(root, 'state'),
        packageDir: join(root, 'packages'),
        cacheDir: join(root, 'cache'),
        legacyUserDir: join(root, 'legacy'),
      };
      for (const dir of ['builtin', 'user', 'state', 'packages']) mkdirSync(join(root, dir), { recursive: true });
      const onEvent = vi.fn();
      const watcher = watchAdapterState(adapterPaths, onEvent, { intervalMs: 20 });
      const files = new Map([
        ['manifest.json', JSON.stringify({
          schema_version: 2,
          name: 'demo.example.com',
          version: '1.0.0',
          description: 'Fixture',
          match: ['demo.example.com'],
          commands: [{
            id: 'list',
            runtime: 'extension',
            module: 'extension/commands/list.js',
            description: 'List',
            schema: { type: 'object', properties: {} },
          }],
        })],
        ['extension/commands/list.js', '(function(){})();'],
      ]);
      installAdapter({ files, origin: { kind: 'local' } }, { paths: adapterPaths });
      await watcher.poll();
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'adapter_state_changed',
        previousRevision: 0,
        revision: 1,
        adapters: ['demo.example.com'],
      }));
      watcher.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('returns an idempotent reconnect snapshot without claiming changed names', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adapter-state-snapshot-'));
    try {
      const stateDir = join(root, 'state');
      mkdirSync(stateDir, { recursive: true });
      const watcher = watchAdapterState(paths(root), vi.fn(), { intervalMs: 20 });
      expect(watcher.snapshot()).toMatchObject({ profile: 'public', previousRevision: 0, revision: 0, adapters: [], sync: true });
      const installations = Object.create(null);
      installations['demo.example.com'] = { name: 'demo.example.com', digest: 'a'.repeat(64) };
      writeAdapterState(paths(root), state(1, installations));
      await watcher.poll();
      expect(watcher.snapshot()).toMatchObject({
        type: 'adapter_state_changed',
        profile: 'public',
        previousRevision: 1,
        revision: 1,
        adapters: [],
        sync: true,
      });
      watcher.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('reports malformed state without emitting a partial event', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adapter-state-watch-'));
    try {
      const stateDir = join(root, 'state');
      mkdirSync(stateDir, { recursive: true });
      const onError = vi.fn();
      const watcher = watchAdapterState(paths(root), vi.fn(), { intervalMs: 20, onError });
      writeFileSync(join(stateDir, 'registry.json'), '{broken');
      await watcher.poll();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      watcher.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
