import { it, expect } from 'vitest';
import { normalizePathParameters, resolvePathRequest } from '../generation-harness/path-parameters.js';
import { structuralUrl } from '../exploration-evidence.js';
const candidate = { url: 'https://example.com/api/groups/:id/items/:id?limit=%3Cvalue%3E', requestEvidence: { bodyKeys: ['filter'] } };
const bindings = [{ segmentIndex: 2, name: 'groupId', description: 'Public group identifier' }, { segmentIndex: 4, name: 'itemId', description: 'Public item identifier' }];
it('requires complete explicit path bindings without reusing captured IDs or clashing with request fields', () => {
  expect(structuralUrl('https://example.com/api/groups/12345/items/67890')).toBe('https://example.com/api/groups/:id/items/:id');
  expect(normalizePathParameters(candidate, bindings)).toEqual(bindings);
  for (const input of [undefined, [], bindings.slice(0, 1), [...bindings, bindings[0]], [bindings[0], { ...bindings[1], name: 'groupId' }],
    [bindings[0], { ...bindings[1], name: 'limit' }], [bindings[0], { ...bindings[1], name: 'filter' }],
    [bindings[0], { ...bindings[1], name: 'token' }], [bindings[0], { ...bindings[1], segmentIndex: -1 }]]) expect(() => normalizePathParameters(candidate, input)).toThrow();
});
it('encodes identifiers as one segment, preserves origin/static route and separates path/query/body arguments', () => {
  const first = resolvePathRequest(candidate.url, bindings, { groupId: '000123', itemId: 'Example 中文?#', limit: 3, filter: { enabled: true } });
  const url = new URL(first.url);
  expect(url.origin).toBe('https://example.com');
  expect(url.pathname).toBe('/api/groups/000123/items/Example%20%E4%B8%AD%E6%96%87%3F%23');
  expect(url.search).toBe('?limit=3'); expect(first.params).toEqual({ filter: { enabled: true } });
  const second = resolvePathRequest(candidate.url, bindings, { groupId: '000124', itemId: 'another' });
  expect(second.url).toBe('https://example.com/api/groups/000124/items/another');
});
it('rejects missing and unsafe path values before any request can happen', () => {
  for (const itemId of [undefined, null, 123, {}, '', ' ', '.', '..', 'a/b', 'a\\b', '%2e%2e', ':id', '<value>', '\ud800', 'a\n']) {
    expect(() => resolvePathRequest(candidate.url, bindings, { groupId: 'example', itemId })).toThrow();
  }
});
