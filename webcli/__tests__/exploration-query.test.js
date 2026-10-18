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

it('binds page path identifiers without capturing values and validates them before navigation', async () => {
  const source = normalizePageQuery({ mode: 'navigate', result: input.result, resultPathname: '/groups/:id/items/:id',
    pathParameters: [{ segmentIndex: 1, name: 'groupId', description: 'Public group identifier' }, { segmentIndex: 3, name: 'itemId', description: 'Public item identifier' }] });
  expect(pageQueryValues(source, { groupId: '007', itemId: '示例' })).toEqual({ groupId: '007', itemId: '示例' });
  for (const itemId of [7, '..', 'a/b', '%2f', '', '\ud800']) expect(() => pageQueryValues(source, { groupId: '007', itemId })).toThrow();
  expect(() => pageQueryValues(source, { groupId: '007', itemId: '008', extra: true })).toThrow();
  const { strategy, ...navigationInput } = source;
  for (const extra of [{ resultPathname: '/items/007' }, { pathParameters: [] }, { resultPathname: '//example.org/:id' }, { resultPathname: '/delete/:id/items/:id' }]) expect(() => normalizePageQuery({ ...navigationInput, ...extra })).toThrow();
  const observation = pageObservation({ source, url: 'https://example.com/start', shape: { type: 'object' }, reason: 'Read a public detail page' });
  const generated = buildPageTool('example.com', { name: 'detail' }, observation);
  expect(generated.toolDefinition.pageRoute.navigation.pathname).toBe('/groups/:id/items/:id');
  expect(generated.toolDefinition.parameters.required).toEqual(['groupId', 'itemId']);
  let handler; vm.runInNewContext(generated.v2Content, { window: { __webcliRegisterCommand: (_id, fn) => handler = fn } });
  expect((await handler({ groupId: '007', itemId: '008' })).__webcli_page_query.source.mode).toBe('navigate');
  const result = { ok: true, data: { title: 'Example' } };
  expect(await handler({ groupId: '007', itemId: '008' }, { kind: 'page_query_result', result })).toBe(result);
  expect(pageObservation({ source, url: 'https://example.com/groups/:id/items/:id', shape: {}, reason: 'Read current detail' }).expectedPath).toBe('/groups/:id/items/:id');
});

it('binds query-only and mixed navigation parameters while preserving exact string values and shared implementations', async () => {
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(new URL('../page-navigation-parameters.js', import.meta.url), 'utf8')).toBe(readFileSync(new URL('../../extension/background/page-navigation-parameters.js', import.meta.url), 'utf8'));
  const { resolvePageDestination } = await import('../../extension/background/page-navigation.js');
  const raw = { mode: 'navigate', result: input.result, resultPathname: '/items', queryParameters: [{ name: 'keyword', queryKey: 'q', description: 'Public query' }] };
  const source = normalizePageQuery(raw);
  expect(source.pathParameters).toEqual([]);
  for (const keyword of ['007', '示例 & +?#%', 'a/b']) {
    expect(pageQueryValues(source, { keyword })).toEqual({ keyword });
    const destination = resolvePageDestination('https://example.com', source, { keyword });
    expect(destination.searchParams.get('q')).toBe(keyword); expect([...destination.searchParams.keys()]).toEqual(['q']); expect(destination.hash).toBe('');
  }
  for (const keyword of [7, '', '\u0000', '\ud800', '<value>', 'x'.repeat(513)]) {
    expect(() => pageQueryValues(source, { keyword })).toThrow();
    expect(() => resolvePageDestination('https://example.com', source, { keyword })).toThrow();
  }
  for (const queryKey of ['token', 'authorization', 'action', 'redirect_uri', 'constructor']) expect(() => normalizePageQuery({ ...raw, queryParameters: [{ ...raw.queryParameters[0], queryKey }] })).toThrow();
  const mixed = { ...raw, resultPathname: '/groups/:id', pathParameters: [{ segmentIndex: 1, name: 'groupId', description: 'Public group ID' }] };
  expect(() => normalizePageQuery({ ...mixed, queryParameters: [{ ...raw.queryParameters[0], name: 'groupId' }] })).toThrow();
  expect(() => pageQueryValues(source, { keyword: 'Example', extra: 'ignored' })).toThrow();
  const observation = pageObservation({ source, url: 'https://example.com/entry', shape: {}, reason: 'Explicit public query route' });
  const generated = buildPageTool('example.com', { name: 'query-detail' }, observation);
  expect(generated.toolDefinition.parameters.required).toEqual(['keyword']);
  expect(generated.toolDefinition.pageRoute.navigation.queryParameters).toEqual(source.queryParameters);
});

it('validates and permission-binds query navigation manifests and refuses ambiguous or unsafe bindings', async () => {
  const { validateV2Manifest } = await import('../adapter-package-validation.js');
  const { adapterPermissions } = await import('../adapter-catalog.js');
  const source = normalizePageQuery({ mode: 'navigate', result: input.result, resultPathname: '/items', queryParameters: [{ name: 'keyword', queryKey: 'q', description: 'Public query' }] });
  const generated = buildPageTool('example', { name: 'query' }, pageObservation({ source, url: 'https://example.com/entry', shape: {}, reason: 'Public query navigation' }));
  const manifest = { schema_version: 2, name: 'example', version: '1.0.0', description: 'Public example', match: ['example.com'], commands: [{ id: 'query', description: 'Public query', runtime: 'extension', module: 'extension/commands/query.js', schema: generated.toolDefinition.parameters, safety: 'read', pageWorkflow: true, pageStrategy: 'UI_SELECTOR', pageRoute: generated.toolDefinition.pageRoute }] };
  expect(() => validateV2Manifest(manifest)).not.toThrow();
  const permissions = adapterPermissions(manifest);
  expect(permissions.join('\n')).toContain('queryParameters');
  const changed = structuredClone(manifest); changed.commands[0].pageRoute.navigation.queryParameters[0].queryKey = 'search';
  expect(adapterPermissions(changed)).not.toEqual(permissions);
  for (const queries of [[], [{ name: 'keyword', queryKey: 'token', description: 'Public query' }], [...source.queryParameters, ...source.queryParameters]]) {
    const bad = structuredClone(manifest); bad.commands[0].pageRoute.navigation.queryParameters = queries;
    expect(() => validateV2Manifest(bad)).toThrow();
  }
});

const hashInput = { mode: 'navigate', resultPathname: '/app', result: { strategy: 'DOM_STATE', path: ['publicResult'] },
  hashNavigation: { template: 'items/:id', pathParameters: [{ segmentIndex: 1, name: 'itemId', description: 'Public item ID' }],
    matchResult: { 'item.id': 'itemId' }, freshnessPath: 'revision', sameTarget: 'reload' } };
it('normalizes hash route/correlation/freshness into generated permissions and exact values', async () => {
  const { validateV2Manifest } = await import('../adapter-package-validation.js');
  const { adapterPermissions } = await import('../adapter-catalog.js');
  const { resolvePageDestination, assertPageQueryRoute } = await import('../../extension/background/page-navigation.js');
  const source = normalizePageQuery(hashInput);
  for (const itemId of ['007', '示例', 'x?#&']) {
    expect(pageQueryValues(source, { itemId })).toEqual({ itemId });
    expect(resolvePageDestination('https://example.com', source, { itemId }).hash).toBe('#items/' + encodeURIComponent(itemId));
  }
  const generated = buildPageTool('example', { name: 'hash' }, pageObservation({ source, url: 'https://example.com/entry', shape: {}, reason: 'Public hash result' }));
  const command = { id: 'hash', description: 'Public hash', runtime: 'extension', module: 'extension/commands/hash.js', schema: generated.toolDefinition.parameters, safety: 'read', pageWorkflow: true, pageStrategy: 'UI_SELECTOR', pageRoute: generated.toolDefinition.pageRoute };
  const manifest = { schema_version: 2, name: 'example', version: '1.0.0', description: 'Public example', match: ['example.com'], commands: [command] };
  expect(() => validateV2Manifest(manifest)).not.toThrow();
  expect(generated.toolDefinition.parameters.required).toEqual(['itemId']);
  expect(adapterPermissions(manifest).join(' ')).toContain('freshnessPath');
  const payload = { version: 1, source, expectedOrigin: 'https://example.com', expectedPath: '/entry', values: { itemId: '007' } };
  expect(assertPageQueryRoute(payload, command)).toBe('https://example.com/app#items/007');
  const changed = structuredClone(payload); changed.source.hashNavigation.freshnessPath = 'other';
  expect(() => assertPageQueryRoute(changed, command)).toThrow();
  manifest.commands[0].pageRoute.navigation.hashNavigation.matchResult = {};
  expect(() => validateV2Manifest(manifest)).toThrow();
});
it('rejects unsafe hash templates, missing correlation/freshness and invalid values before dispatch', () => {
  for (const extra of [{ sameTarget: 'read-current' }, { freshnessPath: 'token' }, { matchResult: {} }, { matchResult: { 'item.id': 'other' } },
    { template: 'delete/:id' }, { template: '//example.com/:id' }, { template: 'items/:other' }, { template: 'items/%2e/:id' }, { template: 'items/:id?q=x' },
    { pathParameters: [] }, { pathParameters: [{ segmentIndex: 1, name: 'token', description: 'Bad' }] }]) {
    expect(() => normalizePageQuery({ ...hashInput, hashNavigation: { ...hashInput.hashNavigation, ...extra } })).toThrow();
  }
  const source = normalizePageQuery(hashInput);
  for (const itemId of [7, '', '.', '..', '%2f', 'a/b', '\u0000', '\ud800']) expect(() => pageQueryValues(source, { itemId })).toThrow();
});
it('supports independently correlated fragment query, URL query and path bindings in a workflow', async () => {
  const { pageWorkflowContract, validatePageWorkflowContract, workflowParameters } = await import('../exploration-workflow.js');
  const { resolvePageDestination } = await import('../../extension/background/page-navigation.js');
  const query = { ...hashInput, resultPathname: '/groups/:id', pathParameters: [{ segmentIndex: 1, name: 'groupId', description: 'Public group' }],
    queryParameters: [{ name: 'locale', queryKey: 'lang', description: 'Public locale' }], hashNavigation: { ...hashInput.hashNavigation,
      queryParameters: [{ name: 'category', queryKey: 'category', description: 'Public category' }],
      matchResult: { group: 'groupId', locale: 'locale', 'item.id': 'itemId', category: 'category' } } };
  const source = normalizePageQuery({ mode: 'workflow', steps: [{ pathname: '/entry', query: { mode: 'navigate', resultPathname: '/entry', result: hashInput.result } }, { pathname: '/entry', query }] });
  expect(validatePageWorkflowContract(pageWorkflowContract(source))).toEqual(source);
  expect(workflowParameters(source).map(item => item.name)).toEqual(['groupId', 'locale', 'itemId', 'category']);
  const values = { groupId: '007', locale: 'zh', itemId: '示例', category: 'a&+?#%' };
  expect(pageQueryValues(source, values)).toEqual(values);
  const url = resolvePageDestination('https://example.com', source.steps[1].query, values);
  expect(url.pathname).toBe('/groups/007'); expect(url.search).toBe('?lang=zh');
  expect(new URLSearchParams(url.hash.split('?')[1]).get('category')).toBe(values.category);
});

it('normalizes bounded workflow controls, binds permission changes and shares the exact validation code', async () => {
  const { normalizePageWorkflow, pageWorkflowContract, validatePageWorkflowContract } = await import('../exploration-workflow.js');
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(new URL('../page-workflow-control.js', import.meta.url), 'utf8')).toBe(readFileSync(new URL('../../extension/background/page-workflow-control.js', import.meta.url), 'utf8'));
  const query = { mode: 'filter', resultPathname: '/items', result: { strategy: 'DOM_STATE', path: ['publicResults'] }, trigger: { kind: 'pagination', selector: '#next' } };
  const raw = { mode: 'workflow', steps: [{ pathname: '/items', query }, { pathname: '/items', query, when: { path: 'hasNext', equals: true }, repeat: { maxIterations: 3, until: { path: 'hasNext', equals: false }, collect: { path: 'items', identityPath: 'id', maxItems: 100, includePrevious: true } } }] };
  const source = normalizePageWorkflow(raw), contract = pageWorkflowContract(source);
  expect(pageWorkflowContract(validatePageWorkflowContract(contract))).toEqual(contract);
  const { adapterPermissions } = await import('../adapter-catalog.js');
  const manifest = { commands: [{ runtime: 'extension', pageRoute: { origin: 'https://example.com', pathname: '/items', workflow: contract } }] };
  const permissions = adapterPermissions(manifest);
  const changed = structuredClone(manifest); changed.commands[0].pageRoute.workflow.steps[1].repeat.maxIterations = 4;
  expect(adapterPermissions(changed)).not.toEqual(permissions);
  for (const mutate of [x => x.steps[0].when = { path: 'hasNext', equals: true }, x => x.steps[1].when.path = 'auth.secret', x => x.steps[1].repeat.maxIterations = 99,
    x => x.steps[1].repeat.collect.maxItems = 0, x => x.steps[1].repeat.until.equals = {}, x => x.steps[1].repeat.code = 'example', x => x.steps[1].pathname = '/other']) {
    const bad = structuredClone(raw); mutate(bad); expect(() => normalizePageWorkflow(bad)).toThrow();
  }
});
