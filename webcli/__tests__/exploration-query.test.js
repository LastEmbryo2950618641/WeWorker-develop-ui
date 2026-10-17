import { expect, it } from 'vitest';
import vm from 'node:vm';
import { normalizePageQuery, pageQueryValues } from '../exploration-query.js';
import { buildPageTool, pageObservation } from '../exploration-page.js';
const input = { trigger: { kind: 'search', selector: '#q', submitSelector: '#search', parameter: 'keyword', description: 'Public search term' },
  result: { strategy: 'UI_SELECTOR', selector: '.item', fields: { title: { selector: 'h3' } } }, resultPathname: '/results', matchQuery: { q: 'keyword' } };
it('requires an explicit read control, same-origin result pathname and query correlation', () => {
  const source = normalizePageQuery(input); expect(source.mode).toBe('query');
  expect(pageQueryValues(source, { keyword: 'Example' })).toEqual({ keyword: 'Example' });
  for (const extra of [{ resultPathname: '//example.org/results' }, { resultPathname: '/results?token=x' }, { matchQuery: {} }, { matchQuery: { token: 'keyword' } }, { trigger: { ...input.trigger, kind: 'submit' } }]) expect(() => normalizePageQuery({ ...input, ...extra })).toThrow();
});
it('generates a two-phase handler with exact page routes and no query replay on continuation', async () => {
  const observation = pageObservation({ source: normalizePageQuery(input), url: 'https://example.com/start', shape: { type: 'object' }, reason: 'Read search result after navigation' });
  const generated = buildPageTool('example.com', { name: 'query_items' }, observation);
  expect(generated.toolDefinition.pageWorkflow).toBe(true);
  expect(generated.toolDefinition.pageRoute).toEqual({ origin: 'https://example.com', pathname: '/start', additionalPaths: ['/results'] });
  let handler; const context = vm.createContext({ window: { __webcliRegisterCommand: (_id, value) => { handler = value; } } });
  vm.runInContext(generated.v2Content, context);
  expect((await handler({ keyword: 'Example' })).__webcli_page_query.values.keyword).toBe('Example');
  const result = { ok: true, data: { items: [{ title: 'Example' }] } };
  expect(await handler({ keyword: 'Example' }, { kind: 'page_query_result', result })).toBe(result);
});
