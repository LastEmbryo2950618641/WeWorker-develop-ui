import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { scopedGenerationPreviewScripts } from '../background/generation-preview-bundle.js';
import { buildV2Bootstrap } from '../background/v2-loader.js';

const token = '00000000-0000-4000-8000-000000000001';
function setup() {
  let listener;
  const events = {};
  const installed = { unchanged: true };
  const window = { location: { href: 'https://example.com/', hostname: 'example.com' }, __webmcpGeneratedSupport: installed,
    __webmcpRegister() { throw new Error('Preview must not register production tools'); }, addEventListener: (name, callback) => { events[name] = callback; } };
  const context = vm.createContext({ window, setTimeout: () => 1, clearTimeout() {}, chrome: { runtime: { onMessage: { addListener: value => { listener = value; } } } } });
  vm.runInContext(readFileSync(new URL('../content/preview-registry.js', import.meta.url), 'utf8'), context);
  context.__weworkerPreviewRegistry = window.__weworkerPreviewRegistry;
  const message = payload => new Promise(resolve => listener(payload, {}, resolve));
  const run = scripts => { for (const script of scopedGenerationPreviewScripts(scripts, token)) vm.runInContext(script.source, context); };
  return { message, window, installed, events, run, context };
}

test('preview registration and mutable package globals never enter the installed registry', async () => {
  const f = setup();
  assert.equal((await f.message({ type: 'begin_generation_preview', token, siteKey: 'example.com', previewAdapterId: 'generation_preview_fixture', packageDigest: 'a'.repeat(64) })).ok, true);
  f.run([
    { path: 'bootstrap.js', source: buildV2Bootstrap({ name: 'example.com', commands: [{ id: 'list', runtime: 'extension' }] }) },
    { path: 'command.js', source: 'window.__webmcpGeneratedSupport = { draft: true }; __webcliRegisterCommand("list", () => window.__webmcpGeneratedSupport);' },
  ]);
  const listing = await f.message({ type: 'get_generation_preview', token });
  assert.equal(listing.tools[0].name, 'example.com.list');
  assert.equal(listing.packageDigest, 'a'.repeat(64));
  assert.equal(listing.previewAdapterId, 'generation_preview_fixture');
  assert.equal((await f.message({ type: 'call_generation_preview', token, toolName: 'example.com.list' })).result.draft, true);
  assert.equal(f.window.__webmcpGeneratedSupport, f.installed);
  assert.equal(f.window.__webcliRegisterCommand, undefined);
  await f.message({ type: 'end_generation_preview', token });
  assert.match((await f.message({ type: 'call_generation_preview', token, toolName: 'example.com.list' })).error, /expired/);
});

test('wrong site, concurrent session, navigation and pagehide cannot reuse the task registry', async () => {
  const f = setup();
  assert.equal((await f.message({ type: 'begin_generation_preview', token, siteKey: 'example.org' })).ok, false);
  await f.message({ type: 'begin_generation_preview', token, siteKey: 'example.com' });
  assert.equal((await f.message({ type: 'begin_generation_preview', token, siteKey: 'example.com' })).ok, false);
  f.window.location.href = 'https://example.com/changed';
  assert.equal((await f.message({ type: 'get_generation_preview', token })).ok, false);
  f.events.pagehide();
  f.window.location.href = 'https://example.com/';
  assert.equal((await f.message({ type: 'get_generation_preview', token })).ok, false);
  assert.equal((await f.message({ type: 'begin_generation_preview', token, siteKey: 'example.com' })).ok, true);
});

test('late completion cannot return a result after its preview session ended', async () => {
  const f = setup();
  await f.message({ type: 'begin_generation_preview', token, siteKey: 'example.com' });
  f.run([{ path: 'command.js', source: 'window.__webmcpRegister({tools:[{name:"slow",handler:()=>new Promise(resolve=>window.finishFixture=resolve)}]});' }]);
  const pending = f.message({ type: 'call_generation_preview', token, toolName: 'slow' });
  await Promise.resolve();
  const scope = f.window.__weworkerPreviewRegistry.scope(token);
  await f.message({ type: 'end_generation_preview', token });
  scope.finishFixture('late');
  assert.match((await pending).error, /expired/);
});

for (const fail of [false, true]) {
  test(`service worker uses only task registration and cleans up after injection failure=${fail}`, async () => {
    const f = setup();
    const messages = [];
    const source = readFileSync(new URL('../background/service-worker.js', import.meta.url), 'utf8');
    const body = source.slice(source.indexOf('async function validateGenerationPreview('), source.indexOf('function shouldHandleTabUrl('));
    const context = vm.createContext({
      crypto: { randomUUID: () => token }, SAFE_ADAPTER_ID_RE: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
      findGenerationPreviewTab: async () => ({ id: 7, url: 'https://example.com/' }),
      normalizeGenerationPreviewBundle: value => value, normalizeAdapterSupportFiles: () => [], scopedGenerationPreviewScripts,
      chrome: { scripting: { executeScript: async () => [] }, tabs: { sendMessage: async (_id, message) => { messages.push(message); return f.message(message); } } },
      injectGenerationPreviewSourcesWithCdp: async (_id, scripts) => { for (const script of scripts) await vm.runInContext(script.source, f.context); if (fail) throw new Error('Fixture injection failure'); },
      sendTabMessage: async (_id, message) => { messages.push(message); return f.message(message); },
      callGenerationPreviewTool: async (_id, sessionToken, toolName, args) => (await f.message({ type: 'call_generation_preview', token: sessionToken, toolName, args })).result,
      validateGenerationPreviewOutput: output => ({ passed: output === 'draft' }),
    });
    vm.runInContext(body, context);
    const promise = context.validateGenerationPreview({ previewAdapterId: 'generation_preview_fixture', siteKey: 'example.com', tabId: 7,
      previewBundle: { manifest: {}, scripts: [{ path: 'fixture.js', source: 'window.__webmcpRegister({tools:[{name:"example.com.list",handler:()=>"draft"}]});' }] },
      expectedToolNames: ['example.com.list'], testCases: [{ toolName: 'example.com.list', execute: true, risk: { level: 'read', confidence: 1 } }],
    });
    if (fail) await assert.rejects(promise, /Fixture injection failure/);
    else { const result = await promise; assert.equal(result.passed, true); assert.equal(result.executionSummary.attempted, 1); }
    assert.equal(messages.at(-1).type, 'end_generation_preview');
    assert.equal(messages.some(message => ['clear_tools', 'call_tool', 'resync_tools'].includes(message.type)), false);
    assert.equal((await f.message({ type: 'get_generation_preview', token })).ok, false);
    assert.equal(f.window.__webmcpGeneratedSupport, f.installed);
  });
}
