import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeWorkflowOrigin, workflowOriginRoutes, workflowOriginTargets, matchesOriginTarget } from '../page-workflow-origins.js';
const source = { steps: [
  { pathname: '/entry', query: { mode: 'navigate', resultOrigin: 'https://example.org', resultPathname: '/items' } },
  { origin: 'https://example.org', pathname: '/items', query: { mode: 'filter', resultPathname: '/items' } },
  { origin: 'https://example.org', pathname: '/items', query: { mode: 'navigate', resultOrigin: 'https://example.com', resultPathname: '/results' } },
] };
it('resolves only the exact declared origin transitions and preserves entry identity', () => {
  const routes = workflowOriginRoutes(source, 'https://example.com');
  expect(routes.map(x => [x.origin, x.resultOrigin])).toEqual([
    ['https://example.com','https://example.org'], ['https://example.org','https://example.org'], ['https://example.org','https://example.com'],
  ]);
  expect(workflowOriginTargets(source, 'https://example.com')).toEqual([
    { origin: 'https://example.com', pathname: '/entry' }, { origin: 'https://example.org', pathname: '/items' },
    { origin: 'https://example.org', pathname: '/items' }, { origin: 'https://example.com', pathname: '/results' },
  ]);
});
it('rejects missing chain declarations and cross-origin conditional, repeated or non-navigation actions', () => {
  for (const mutate of [x => delete x.steps[1].origin, x => x.steps[0].origin = 'https://example.org',
    x => x.steps[0].when = { path: 'hasNext', equals: true }, x => x.steps[0].repeat = {}, x => x.steps[0].query.mode = 'filter']) {
    const changed = structuredClone(source); mutate(changed); expect(() => workflowOriginRoutes(changed, 'https://example.com')).toThrow();
  }
});
it('rejects ambiguous URL spellings, dynamic targets and credentials without changing loopback ports', () => {
  for (const value of ['https://example.com/', 'https://example.com/path', 'https://example.com?q=1', 'https://example.com#x', 'https://user:placeholder@example.com', 'https://example.com:443', 'https://EXAMPLE.com', '//example.com', 'file:///example', 'https://:host', null]) expect(() => normalizeWorkflowOrigin(value)).toThrow();
  expect(normalizeWorkflowOrigin('http://127.0.0.1:12345')).toBe('http://127.0.0.1:12345');
});
it('retains same-origin workflow behavior and identical host/extension validation sources', () => {
  const old = { steps: [{ pathname: '/entry', query: { mode: 'navigate', resultPathname: '/items' } }, { pathname: '/items', query: { mode: 'filter', resultPathname: '/items' } }] };
  expect(workflowOriginRoutes(old, 'https://example.com').every(x => x.origin === x.resultOrigin)).toBe(true);
  expect(readFileSync(new URL('../page-workflow-origins.js', import.meta.url), 'utf8')).toBe(readFileSync(new URL('../../extension/background/page-workflow-origins.js', import.meta.url), 'utf8'));
});

it('matches an exact origin including its port and keeps structural summaries distinct from real tab URLs', () => {
  const target = { origin: 'http://localhost:12345', pathname: '/items/:id' };
  expect(matchesOriginTarget(new URL('http://localhost:12345/items/007'), target)).toBe(true);
  for (const address of ['http://localhost:23456/items/007', 'http://127.0.0.1:12345/items/007', 'https://localhost:12345/items/007',
    'http://localhost:12345/items/:id', 'http://localhost:12345/items/%2F', 'http://localhost:12345/items/%2531', 'http://localhost:12345/items/007/extra']) expect(matchesOriginTarget(new URL(address), target)).toBe(false);
  expect(matchesOriginTarget(new URL('http://localhost:12345/items/:id'), target, true)).toBe(true);
});

it('cross-origin generated permissions require every destination host and retain the declared chain', async () => {
  const { normalizePageQuery } = await import('../exploration-query.js');
  const { buildPageTool, pageObservation } = await import('../exploration-page.js');
  const { validateV2Manifest } = await import('../adapter-package-validation.js');
  const result = { strategy: 'DOM_STATE', path: ['publicResult'] };
  const read = normalizePageQuery({ mode: 'navigate', resultPathname: '/items/:id', resultOrigin: 'https://example.org', pathParameters: [{ name: 'itemId', segmentIndex: 1, description: 'Public item ID' }], result });
  const generated = buildPageTool('example', { name: 'read' }, pageObservation({ source: read, url: 'https://example.com/entry', shape: {}, reason: 'Explicit destination' })).toolDefinition;
  const manifest = { schema_version: 2, name: 'example', version: '1.0.0', description: 'Example', match: ['example.com'], commands: [{ id: 'read', runtime: 'extension', module: 'extension/commands/read.js', description: 'Read', schema: generated.parameters, safety: 'read', pageRoute: generated.pageRoute, pageStrategy: generated.pageStrategy, pageWorkflow: true }] };
  expect(() => validateV2Manifest(manifest)).toThrow();
  manifest.match.push('example.org'); expect(() => validateV2Manifest(manifest)).not.toThrow();
  const { pageWorkflowContract, normalizePageWorkflow } = await import('../exploration-workflow.js');
  const flow = normalizePageWorkflow({ mode: 'workflow', steps: source.steps.map(step => ({ ...step, query: { ...step.query, result, ...(step.query.mode === 'filter' ? { trigger: { kind: 'pagination', selector: '#next' } } : {}) } })) });
  manifest.commands[0].pageRoute = { origin: 'https://example.com', pathname: '/entry', workflow: pageWorkflowContract(flow) };
  expect(() => validateV2Manifest(manifest)).not.toThrow();
  delete manifest.commands[0].pageRoute.workflow.steps[1].origin;
  expect(() => validateV2Manifest(manifest)).toThrow();
});
