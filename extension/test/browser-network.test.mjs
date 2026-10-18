import test from 'node:test';
import assert from 'node:assert/strict';
import { browserNetworkBody, browserNetworkUrl } from '../background/browser-network.js';
import { executeBrowserCommand } from '../background/browser-commands.js';

test('a key from an all-traffic listing is readable without repeating the business filter', async () => {
  const entry = { requestId: 'example-request', url: 'https://example.com/api/monitor/usage', method: 'GET',
    status: 200, timestamp: 100, responseContentType: 'application/json' };
  let captured = true; const reads = [];
  const dependencies = {
    chrome: { storage: { session: { get: async () => ({ 'webcli-browser-tab-7': 'example-identity' }) } },
      tabs: { get: async () => ({ url: 'https://example.com/usage' }) },
      debugger: { sendCommand: async (target, method, args) => {
        reads.push({ target, method, args }); return { body: '{"window":"example-window","token":"example-secret"}' };
      } } },
    getCdpNetworkSnapshot: async (_id, { businessOnly }) => ({ source: 'cdp', entries: captured && !businessOnly ? [entry] : [] }),
  };
  const call = args => executeBrowserCommand({ command: 'network', tabId: 7, identity: 'example-identity', args }, dependencies);
  assert.equal((await call({})).data.totalEntries, 0);
  const list = await call({ all: true });
  const detail = await call({ detail: list.data.entries[0].key });
  assert.equal(detail.ok, true);
  assert.equal(detail.data.entry.response.window, 'example-window');
  assert.equal(detail.data.entry.response.token, '[redacted]');
  assert.deepEqual(reads, [{ target: { tabId: 7 }, method: 'Network.getResponseBody', args: { requestId: 'example-request' } }]);
  captured = false;
  assert.equal((await call({ detail: 'example-request' })).error.code, 'NETWORK_ENTRY_EXPIRED');
  assert.equal(reads.length, 1);
});

test('network details preserve business fields and redact nested credentials', () => {
  const result = browserNetworkBody('{"data":{"title":"Example","count":2,"access_token":"placeholder-token"},"headers":{"Authorization":"placeholder-auth"}}');
  assert.equal(result.data.title, 'Example'); assert.equal(result.data.count, 2);
  assert.equal(result.data.access_token, '[redacted]'); assert.equal(result.headers.Authorization, '[redacted]');
  assert.doesNotMatch(browserNetworkUrl('https://example.com/api?q=example&token=placeholder-token'), /placeholder-token/);
});
test('truncated and unstructured bodies are explicitly omitted instead of leaking prefixes', () => {
  assert.equal(browserNetworkBody('{"token":"placeholder-secret').omitted, true);
  assert.equal(browserNetworkBody('token=placeholder-secret').omitted, true);
});

test('large response bodies retain complete type-only evidence beyond the preview limit', async () => {
  const { browserResponseEvidence } = await import('../background/browser-network.js');
  const evidence = browserResponseEvidence(JSON.stringify({ padding: 'example'.repeat(1000), data: { items: [{ title: 'Example title', count: 1 }] } }));
  assert.equal(evidence.bodyShape.properties.data.properties.items.items.properties.title.type, 'string');
  assert.equal(evidence.bodyTruncated, false);
  assert.doesNotMatch(JSON.stringify(evidence), /Example title|exampleexample/);
});
