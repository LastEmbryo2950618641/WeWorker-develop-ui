import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { createHostAdapterRuntime } from '../../extension/background/host-adapter-runtime.js';
import { buildV2Bootstrap } from '../../extension/background/v2-loader.js';

const manifest = (digest) => ({ name: 'demo', _hostSnapshot: { profile: 'public', digest } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

describe('managed page execution', () => {
  it('defers script replacement until the command using the previous version finishes', async () => {
    const events = [];
    const started = deferred(), finish = deferred();
    const runtime = createHostAdapterRuntime({
      bundle: async (pkg) => pkg, prepare: async () => {},
      clear: async () => { events.push('clear'); },
      inject: async (_tab, pkg) => { events.push(pkg._hostSnapshot.digest); },
    });
    const first = runtime.execute(7, manifest('first'), 'https://example.com/', async () => {
      events.push('start'); started.resolve(); await finish.promise; events.push('finish'); return 'old result';
    });
    await started.promise;
    const update = runtime.execute(7, manifest('second'), 'https://example.com/');
    await Promise.resolve();
    expect(events).toEqual(['clear', 'first', 'start']);
    finish.resolve();
    expect(await first).toBe('old result');
    await update;
    expect(events).toEqual(['clear', 'first', 'start', 'finish', 'clear', 'second']);
    await runtime.execute(7, manifest('second'), 'https://example.com/');
    expect(events).toHaveLength(6);
  });

  it('does not clear a working page when bundle validation fails and recovers its queue', async () => {
    let clears = 0;
    const runtime = createHostAdapterRuntime({
      bundle: async (pkg) => { if (pkg._hostSnapshot.digest === 'bad') throw new Error('bad package'); return pkg; },
      prepare: async () => {}, clear: async () => { clears++; }, inject: async () => {},
    });
    await runtime.execute(7, manifest('first'), 'https://example.com/');
    await expect(runtime.execute(7, manifest('bad'), 'https://example.com/')).rejects.toThrow('bad package');
    expect(clears).toBe(1);
    expect(await runtime.execute(7, manifest('first'), 'https://example.com/', () => 'healthy')).toBe('healthy');
  });

  it('never marks an old document as injected after navigation', async () => {
    let navigate = true, injected = 0;
    const runtime = createHostAdapterRuntime({
      bundle: async (pkg) => pkg, prepare: async () => {}, clear: async () => {},
      inject: async () => { injected++; if (navigate) runtime.invalidate(7); },
    });
    await expect(runtime.execute(7, manifest('first'), 'https://example.com/')).rejects.toThrow(/document changed/);
    navigate = false;
    await runtime.execute(7, manifest('first'), 'https://example.com/');
    expect(injected).toBe(2);
  });
});

describe('v2 page registration', () => {
  it('refreshes definitions after update and enforces the declared write gate', () => {
    const registrations = [];
    const context = vm.createContext({ window: { __webmcpRegister: (entry) => registrations.push(entry) } });
    const pkg = (id, safety) => ({ name: 'demo', match: ['example.com'], commands: [{ id, safety, runtime: 'extension', description: id, schema: {} }] });
    vm.runInContext(buildV2Bootstrap(pkg('old', 'read')), context);
    vm.runInContext('window.__webcliRegisterCommand("old", () => "old result")', context);
    vm.runInContext(buildV2Bootstrap(pkg('new', 'write')), context);
    vm.runInContext('window.__webcliRegisterCommand("new", (args) => args.value)', context);
    expect(registrations[1].tools[0].name).toBe('demo.new');
    expect(() => registrations[1].tools[0].handler({ value: 'blocked' })).toThrow(/confirmation/);
    expect(registrations[1].tools[0].handler({ value: 'approved', __confirmed: true })).toBe('approved');
    expect(() => vm.runInContext('window.__webcliRegisterCommand("old", () => "stale")', context)).toThrow(/unknown command/);
  });
});
