import { explorationError as fail } from './exploration-commands.js';
import { normalizeReadTrigger, interceptValues } from './exploration-intercept.js';
import { normalizePageSource } from './exploration-page.js';
import { normalizePathParameters, resolvePathRequest } from './generation-harness/path-parameters.js';
import { classifyApiCandidateRisk } from './generation-harness/source-evidence.js';
import { normalizePageWorkflow, workflowValues } from './exploration-workflow.js';
import { normalizeNavigationQueryParameters, appendNavigationQuery, navigationParameters } from './page-navigation-parameters.js';
export function pageQueryValues(source, input) {
  if (source.mode === 'workflow') return workflowValues(source, input);
  if (source.mode !== 'navigate') return interceptValues(source, input);
  const values = input || {}, names = navigationParameters(source).map(binding => binding.name);
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(key => !names.includes(key))) throw fail('INVALID_PAGE_QUERY_ARGUMENT', 'Provide only the declared page path/query parameters.');
  try {
    const { url } = resolvePathRequest('https://example.com' + source.resultPathname, source.pathParameters, values);
    const destination = appendNavigationQuery(new URL(url), source.queryParameters || [], values);
    if (classifyApiCandidateRisk({ url: destination.href, method: 'GET' }).level !== 'read') throw new Error('Page navigation must target a read-only detail route.');
  }
  catch (error) { throw fail('INVALID_PAGE_QUERY_ARGUMENT', error.message); }
  return { ...values };
}
export function normalizePageQuery(input, { allowStaticNavigation = false } = {}) {
  const invalid = message => { throw fail('INVALID_PAGE_QUERY', message); };
  if (input?.mode === 'workflow') return normalizePageWorkflow(input);
  if (input?.mode === 'filter') {
    if (!allowStaticNavigation) invalid('Use a filter inside an explicit workflow.');
    if (Object.keys(input).some(key => !['mode', 'trigger', 'result', 'resultPathname', 'matchResult', 'timeoutMs'].includes(key))) invalid('Filter needs a read trigger, result, exact pathname and result correlation.');
    const trigger = normalizeReadTrigger(input.trigger), result = normalizePageSource(input.result);
    const matchResult = input.matchResult || {};
    if (!matchResult || typeof matchResult !== 'object' || Array.isArray(matchResult) || Object.keys(matchResult).length > 10) invalid('matchResult maps up to 10 scalar result paths to parameters.');
    for (const [path, parameter] of Object.entries(matchResult)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*$/.test(path) || path.length > 200
        || /password|secret|token|cookie|auth|session|csrf|constructor|prototype/i.test(path) || parameter !== trigger.parameter) invalid('Correlate public result paths with the trigger parameter.');
    }
    if (trigger.parameter && !Object.keys(matchResult).length) invalid('Parameterized filters require result correlation.');
    let url; try { url = new URL(input.resultPathname, 'https://example.com'); } catch {}
    if (!url || typeof input.resultPathname !== 'string' || !/^\/(?!\/)/.test(input.resultPathname) || url.origin !== 'https://example.com' || url.pathname !== input.resultPathname || url.search || url.hash || url.pathname.includes(':id')) invalid('A filter needs an exact same-origin result pathname.');
    const timeoutMs = input.timeoutMs ?? 10000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) invalid('timeoutMs must be 1000–30000.');
    return { strategy: 'UI_SELECTOR', mode: 'filter', trigger, result, resultPathname: input.resultPathname, matchResult: { ...matchResult }, timeoutMs };
  }
  if (input?.mode === 'navigate') {
    if (Object.keys(input).some(key => !['mode', 'result', 'resultPathname', 'pathParameters', 'queryParameters', 'timeoutMs'].includes(key))) invalid('Navigation requires result, resultPathname and explicit path/query bindings.');
    let url;
    try { url = new URL(input.resultPathname, 'https://example.com'); } catch {}
    if (typeof input.resultPathname !== 'string' || !/^\/(?!\/)/.test(input.resultPathname) || !url || url.origin !== 'https://example.com' || url.pathname !== input.resultPathname || url.search || url.hash) invalid('Use an exact same-origin pathname with :id placeholders.');
    let pathParameters, queryParameters;
    try {
      pathParameters = normalizePathParameters({ url: url.href }, (allowStaticNavigation || input.queryParameters?.length) && input.pathParameters?.length === 0 ? undefined : input.pathParameters);
      queryParameters = normalizeNavigationQueryParameters(input.queryParameters, pathParameters);
    }
    catch (error) { invalid(error.message); }
    if ((!pathParameters.length && !queryParameters.length && !allowStaticNavigation) || pathParameters.some(binding => url.pathname.slice(1).split('/')[binding.segmentIndex] !== ':id')) invalid('Declare public path/query bindings; each path parameter replaces a declared :id segment.');
    if (classifyApiCandidateRisk({ url: url.href, method: 'GET' }).level !== 'read') invalid('Page navigation requires a read-only detail route.');
    const timeoutMs = input.timeoutMs ?? 20000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) invalid('timeoutMs must be 1000–30000.');
    return { strategy: 'UI_SELECTOR', mode: 'navigate', result: normalizePageSource(input.result), resultPathname: input.resultPathname, pathParameters,
      ...(queryParameters.length ? { queryParameters } : {}), timeoutMs };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['trigger', 'result', 'resultPathname', 'matchQuery', 'timeoutMs'].includes(key))) invalid('Provide trigger, result, resultPathname and optional matchQuery/timeoutMs.');
  const trigger = normalizeReadTrigger(input.trigger), result = normalizePageSource(input.result);
  const pathname = input.resultPathname;
  let url; try { url = new URL(pathname, 'https://example.com'); } catch {}
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || !url || url.origin !== 'https://example.com' || url.pathname !== pathname || url.search || url.hash || pathname.includes(':id')) invalid('Choose an exact observed result pathname.');
  const matchQuery = input.matchQuery || {};
  if (!matchQuery || typeof matchQuery !== 'object' || Array.isArray(matchQuery) || Object.keys(matchQuery).length > 10) invalid('matchQuery must map up to 10 public URL query fields to the trigger parameter.');
  for (const [field, parameter] of Object.entries(matchQuery)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(field) || /token|secret|password|cookie|auth|session|csrf|signature/i.test(field) || !trigger.parameter || parameter !== trigger.parameter) invalid('Correlate public result URL fields with the trigger parameter.');
  }
  if (trigger.parameter && !Object.keys(matchQuery).length) invalid('Parameterized page queries require result URL correlation.');
  const timeoutMs = input.timeoutMs ?? 20000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) invalid('timeoutMs must be 1000–30000.');
  return { strategy: 'UI_SELECTOR', mode: 'query', trigger, result, resultPathname: pathname, matchQuery, timeoutMs };
}
