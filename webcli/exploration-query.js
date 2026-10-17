import { explorationError as fail } from './exploration-commands.js';
import { normalizeReadTrigger, interceptValues } from './exploration-intercept.js';
import { normalizePageSource } from './exploration-page.js';
export { interceptValues as pageQueryValues };
export function normalizePageQuery(input) {
  const invalid = message => { throw fail('INVALID_PAGE_QUERY', message); };
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
