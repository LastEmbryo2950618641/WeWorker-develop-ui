import { expect, it } from 'vitest';
import { normalizeInterceptSource, interceptValues } from '../exploration-intercept.js';
import { buildPageTool, pageObservation, pageSourceEvidence } from '../exploration-page.js';
const candidate = { id: 'api-v1-example', url: 'https://api.example.org/search?q=%3Cvalue%3E', method: 'GET', status: 200, risk: { level: 'read' }, responseEvidence: { bodyKind: 'json' }, requestEvidence: { bodyKind: 'none', bodyKeys: [] } };
const source = { sourceApiIndex: 0, trigger: { kind: 'search', selector: '#search', submitSelector: '#submit', parameter: 'keyword', description: 'Public query text' }, matchQuery: { q: 'keyword' } };
it('binds a successful observed query to an explicit UI trigger and required non-captured arguments', () => {
  const normalized = normalizeInterceptSource(source, [candidate]);
  expect(normalized.endpoint).toBe('https://api.example.org/search');
  expect(interceptValues(normalized, { keyword: 'Example' })).toEqual({ keyword: 'Example' });
  for (const values of [{}, { keyword: 4 }, { keyword: '' }, { keyword: 'Example', token: 'example' }]) expect(() => interceptValues(normalized, values)).toThrow();
  const observation = pageObservation({ source: normalized, url: 'https://search.example.com/all?q=example', shape: { type: 'object' }, reason: 'Read public query via page signing' });
  expect(pageSourceEvidence(observation).endpoint).toBe(normalized.endpoint);
  const generated = buildPageTool('example.com', { name: 'search_signed' }, observation);
  expect(generated.toolDefinition.pageStrategy).toBe('INTERCEPT');
  expect(generated.toolDefinition.parameters.required).toEqual(['keyword']);
  expect(generated.toolDefinition.parameters.properties.keyword.default).toBeUndefined();
  expect(generated.v2Content).toContain('intercept_read');
});
it('rejects writes, unsuccessful evidence, dynamic paths, unknown/credential correlation and unsupported controls', () => {
  for (const changes of [{ risk: { level: 'write' } }, { status: 403 }, { method: 'DELETE' }, { responseEvidence: { bodyKind: 'text' } }, { url: 'https://example.com/items/:id?q=x' }]) expect(() => normalizeInterceptSource(source, [{ ...candidate, ...changes }])).toThrow();
  for (const changes of [{ matchQuery: {} }, { matchQuery: { token: 'keyword' } }, { matchQuery: { absent: 'keyword' } }, { matchBody: { q: 'keyword' } }, { timeoutMs: 99 }, { trigger: { ...source.trigger, kind: 'click' } }, { trigger: { ...source.trigger, pressEnter: true } }]) expect(() => normalizeInterceptSource({ ...source, ...changes }, [candidate])).toThrow();
});
it('supports observed JSON/form POST correlation and parameter-free pagination', () => {
  const post = { ...candidate, method: 'POST', requestEvidence: { bodyKind: 'json', bodyKeys: ['filters'] } };
  expect(normalizeInterceptSource({ ...source, matchQuery: {}, matchBody: { 'filters.keyword': 'keyword' } }, [post]).matchBody).toEqual({ 'filters.keyword': 'keyword' });
  const pagination = normalizeInterceptSource({ sourceApiIndex: 0, trigger: { kind: 'pagination', selector: '#next' } }, [candidate]);
  expect(interceptValues(pagination)).toEqual({});
  expect(() => interceptValues(pagination, { page: '2' })).toThrow();
});
