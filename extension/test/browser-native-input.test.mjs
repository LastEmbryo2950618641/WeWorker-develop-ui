import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBrowserCommand } from '../background/browser-commands.js';
for (const command of ['click', 'keys']) test(`${command} brings the bound tab forward before sending native input`, async () => {
  const calls = [];
  let failActivation = false;
  const chrome = { storage: { session: { get: async () => ({ 'webcli-browser-tab-7': 'example-identity' }) } },
    tabs: { get: async () => ({ id: 7, url: 'https://example.com/search' }) },
    scripting: { executeScript: async () => [{ result: { ok: true, data: { x: 20, y: 30 } } }] },
    debugger: { sendCommand: async (_tab, method) => { calls.push(method); if (failActivation && method === 'Page.bringToFront') throw new Error('Activation unavailable'); } },
  };
  const run = () => executeBrowserCommand({ command, tabId: 7, identity: 'example-identity', args: command === 'keys' ? { key: 'Enter' } : { selector: '#search' } }, { chrome, ensureCdpAttached: async () => {} });
  assert.equal((await run()).ok, true);
  assert.equal(calls[0], 'Page.bringToFront'); assert.ok(calls.slice(1).some(method => method.startsWith('Input.dispatch')));
  calls.length = 0; failActivation = true;
  assert.equal((await run()).ok, false); assert.deepEqual(calls, ['Page.bringToFront']);
});
