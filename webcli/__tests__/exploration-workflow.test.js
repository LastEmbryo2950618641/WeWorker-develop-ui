import { expect, it } from 'vitest';
import vm from 'node:vm';
import { normalizePageQuery, pageQueryValues } from '../exploration-query.js';
import { workflowParameters, pageWorkflowContract, validatePageWorkflowContract } from '../exploration-workflow.js';
import { pageWorkflowContract as extensionContract } from '../../extension/background/page-workflow.js';
import { buildPageTool, pageObservation } from '../exploration-page.js';
import { validateV2Manifest } from '../adapter-package-validation.js';
import { adapterPermissions } from '../adapter-catalog.js';
const result = { strategy: 'DOM_STATE', path: ['publicResults'] };
const input = { mode: 'workflow', steps: [
  { pathname: '/entry', query: { mode: 'navigate', resultPathname: '/search', result } },
  { pathname: '/search', query: { mode: 'filter', resultPathname: '/search', result, trigger: { kind: 'filter', selector: '#category', parameter: 'category', description: 'Public category' }, matchResult: { category: 'category' } } },
  { pathname: '/search', query: { resultPathname: '/results', result, trigger: { kind: 'search', selector: '#q', pressEnter: true, parameter: 'keyword', description: 'Public search term' }, matchQuery: { q: 'keyword' } } },
] };
it('normalizes ordered queries and validates all arguments before generating a complete permission contract', async () => {
  const source = normalizePageQuery(input);
  expect(workflowParameters(source).map(x => x.name)).toEqual(['category', 'keyword']);
  expect(pageQueryValues(source, { category: 'books', keyword: '007' })).toEqual({ category: 'books', keyword: '007' });
  for (const values of [{ category: 'books' }, { category: 'books', keyword: '' }, { category: 'books', keyword: '007', extra: true }]) expect(() => pageQueryValues(source, values)).toThrow();
  expect(pageWorkflowContract(source)).toEqual(extensionContract(source));
  expect(validatePageWorkflowContract(pageWorkflowContract(source)).steps).toHaveLength(3);
  const observation = pageObservation({ source, url: 'https://example.com/results', shape: { type: 'object' }, reason: 'Ordered public read workflow' });
  const generated = buildPageTool('example', { name: 'search' }, observation);
  expect(generated.toolDefinition.parameters.required).toEqual(['category', 'keyword']);
  const route = generated.toolDefinition.pageRoute;
  expect(route.pathname).toBe('/entry');
  const manifest = { schema_version: 2, name: 'example', version: '1.0.0', description: 'Public example', match: ['example.com'],
    commands: [{ id: 'search', description: 'Search public results', runtime: 'extension', module: 'extension/commands/search.js', schema: generated.toolDefinition.parameters, safety: 'read', pageWorkflow: true, pageStrategy: 'UI_SELECTOR', pageRoute: route }] };
  expect(() => validateV2Manifest(manifest)).not.toThrow();
  expect(adapterPermissions(manifest)).toContain('page-workflow:' + JSON.stringify(route));
  let handler; vm.runInNewContext(generated.v2Content, { window: { __webcliRegisterCommand: (_id, fn) => handler = fn } });
  expect((await handler({ category: 'books', keyword: '007' })).__webcli_page_query.source.steps).toHaveLength(3);
  const output = { ok: true, data: { category: 'books' } };
  expect(await handler({}, { kind: 'page_query_result', result: output })).toBe(output);
  manifest.commands[0].pageRoute.workflow.steps[1].query.trigger.kind = 'write';
  expect(() => validateV2Manifest(manifest)).toThrow(/workflow/);
});
it('rejects nested, disconnected, uncorrelated, cross-origin or unbounded workflows', () => {
  for (const changed of [{ steps: input.steps.slice(0, 1) }, { timeoutMs: 60000 }, { steps: [input.steps[0], { ...input.steps[1], pathname: '/other' }] },
    { steps: [input.steps[0], { ...input.steps[1], query: input }] },
    { steps: [input.steps[0], { ...input.steps[1], query: { ...input.steps[1].query, matchResult: {} } }] },
    { steps: [{ ...input.steps[0], query: { ...input.steps[0].query, resultPathname: '//example.org/search' } }, input.steps[1]] }]) expect(() => normalizePageQuery({ ...input, ...changed })).toThrow();
});
