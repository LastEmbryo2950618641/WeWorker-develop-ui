import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildV2Bootstrap, v2InjectionFiles } from '../../extension/background/v2-loader.js';
const swSource = fs.readFileSync(new URL('../../extension/background/service-worker.js', import.meta.url), 'utf8');
const bridgeSource = fs.readFileSync(new URL('../bridge.js', import.meta.url), 'utf8');

describe('effective snapshot Extension wiring', () => {
  it('does not let a matching package filename bypass its declared website scope', async () => {
    const context = vm.createContext({
      getCachedRegistry: async () => ({ adapters: [] }),
      findAdapterIdByFileProbe: async () => 'demo',
      loadAdapterManifestAnywhere: async () => ({ name: 'demo', match: ['*.example.com'], except: ['private.example.com'], _hostSnapshot: {} }),
    });
    for (const name of ['adapterMatchesHostname', 'resolveAdapterForHostname']) {
      const start = swSource.indexOf((name === 'resolveAdapterForHostname' ? 'async ' : '') + 'function ' + name + '(');
      vm.runInContext(swSource.slice(start, swSource.indexOf('\n}', start) + 2), context);
    }
    expect((await context.resolveAdapterForHostname('unrelated.example.org')).adapterId).toBeNull();
    expect((await context.resolveAdapterForHostname('private.example.com')).adapterId).toBeNull();
    expect((await context.resolveAdapterForHostname('app.example.com')).adapterId).toBe('demo');
  });

  it('routes catalog and bundle requests to the host snapshot API', () => {
    expect(bridgeSource).toContain("msg.type === 'adapter_catalog' || msg.type === 'adapter_bundle'");
    expect(bridgeSource).toContain('this._handleAdapterSnapshot(msg, ws)');
    expect(swSource).toContain('return getHostAdapterClient().merge(manifests)');
    expect(swSource).toContain('getHostAdapterClient().tools(gatherAllTools())');
    expect(swSource).toContain('msg.adapterSnapshot.digest !== selected.manifest._hostSnapshot.digest');
  });

  it('wires installer state changes to registry and tab refresh', () => {
    expect(bridgeSource).toContain('watchAdapterState(resolveAdapterPaths()');
    expect(bridgeSource).toContain("type: 'adapter_state_changed'");
    expect(swSource).toContain("if (msg.type === 'adapter_state_changed')");
    expect(swSource).toContain('const registry = await doRefreshRegistry()');
    expect(swSource).toContain('await refreshAdapterTabBatch(adapterIds)');
    expect(swSource).toContain('await refreshAdapterState(msg)');
    expect(swSource).toContain('chrome.runtime.sendMessage({ ...msg, registry, refreshedTabs }');
    expect(bridgeSource).toContain('stateSyncTimer');
    expect(bridgeSource).toContain('this._sendAdapterStateSnapshot(ws)');
    expect(swSource).toContain('registry.adapters.filter');
  });
  it('injects one complete snapshot in manifest order without individual file reads', async () => {
    const start = swSource.indexOf('async function injectV2AdapterWithCode(');
    const body = swSource.slice(start, swSource.indexOf('\n}', start) + 2);
    const calls = [];
    const manifest = { name: 'demo', match: ['example.com'], commands: [{ id: 'list', runtime: 'extension', module: 'extension/commands/list.js' }] };
    const bundle = { manifest, files: { 'extension/commands/list.js': 'command', 'extension/internal/shared.js': 'shared' } };
    const context = vm.createContext({
      v2InjectionFiles, buildV2Bootstrap,
      getHostAdapterClient: () => ({ bundle: async () => bundle }),
      cdpAttachedTabs: new Set(), getCdpExecutionContextMap: () => new Map(),
      injectAdapterSources: async (request) => { calls.push(request); },
    });
    vm.runInContext(body, context);
    await context.injectV2AdapterWithCode(7, manifest, 'https://example.com/');
    expect(Array.from(calls[0].scripts, (script) => script.path)).toEqual(['bootstrap.js', 'extension/internal/shared.js', 'extension/commands/list.js']);
    expect(calls[0].expectedUrl).toBe('https://example.com/');
    expect(calls[0].scripts[2].source).toBe('command');
    delete bundle.files['extension/commands/list.js'];
    await expect(context.injectV2AdapterWithCode(7, manifest, 'https://example.com/')).rejects.toThrow(/unavailable/);
    expect(calls).toHaveLength(1);
  });
});
