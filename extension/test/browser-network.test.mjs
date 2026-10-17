import test from 'node:test';
import assert from 'node:assert/strict';
import { browserNetworkBody, browserNetworkUrl } from '../background/browser-network.js';

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
