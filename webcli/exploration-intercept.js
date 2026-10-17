import { explorationError as fail } from './exploration-commands.js';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const sensitive = /password|passwd|secret|cookie|authorization|credential|api.?key|csrf|session|token|signature|ticket|xsrf|^w_rid$|^wts$/i;
const safe = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(value) && !sensitive.test(value) && !['constructor', 'prototype'].includes(value);
const reject = message => { throw fail('INVALID_INTERCEPT_SOURCE', message); };
const keys = (value, names) => { if (!object(value) || Object.keys(value).some(key => !names.includes(key))) reject('Unsupported intercept source fields.'); };
export function normalizeReadTrigger(trigger) {
  keys(trigger, ['kind', 'selector', 'submitSelector', 'parameter', 'description', 'pressEnter']);
  if (!['search', 'filter', 'pagination'].includes(trigger.kind)) reject('trigger.kind must be search, filter or pagination.');
  for (const selector of [trigger.selector, trigger.submitSelector]) if (selector !== undefined && (typeof selector !== 'string' || !selector.trim() || selector.length > 1000)) reject('Use a CSS selector of at most 1000 characters.');
  if (!trigger.selector) reject('A trigger selector is required.');
  if (trigger.pressEnter !== undefined && typeof trigger.pressEnter !== 'boolean') reject('pressEnter must be boolean.');
  if ((trigger.submitSelector || trigger.pressEnter) && trigger.kind !== 'search') reject('Only search triggers support submitSelector or pressEnter.');
  if (trigger.submitSelector && trigger.pressEnter) reject('Choose either a search submit button or Enter.');
  if (trigger.kind !== 'pagination') {
    if (!safe(trigger.parameter) || typeof trigger.description !== 'string' || !trigger.description.trim() || trigger.description.length > 500) reject('Search/filter needs a public parameter name and description.');
  } else if (trigger.parameter || trigger.description) reject('Pagination triggers take no value parameter.');
  return { ...trigger };
}
export function normalizeInterceptSource(input, candidates) {
  keys(input, ['sourceApiIndex', 'trigger', 'matchQuery', 'matchBody', 'timeoutMs']);
  const candidate = Number.isSafeInteger(input.sourceApiIndex) && candidates[input.sourceApiIndex];
  if (!candidate || candidate.risk?.level !== 'read' || candidate.status < 200 || candidate.status >= 300 || !['GET', 'POST'].includes(candidate.method) || candidate.responseEvidence?.bodyKind !== 'json') reject('Select a successful observed read-only JSON API by sourceApiIndex.');
  const url = new URL(candidate.url);
  if (url.pathname.includes(':id')) reject('Intercept currently requires an exact observed endpoint pathname.');
  const trigger = normalizeReadTrigger(input.trigger);
  const correlation = (value = {}, query) => {
    if (!object(value) || Object.keys(value).length > 10) reject('Correlation must map at most 10 request fields to parameters.');
    for (const [field, parameter] of Object.entries(value)) {
      if (!field.split('.').every(safe) || !trigger.parameter || parameter !== trigger.parameter) reject('Correlate public request fields with the trigger parameter.');
      if (query && !url.searchParams.has(field)) reject('matchQuery fields must occur in the observed request.');
      if (!query && !(candidate.requestEvidence?.bodyKeys || []).includes(field.split('.')[0])) reject('matchBody fields must occur in the observed request.');
    }
    return { ...value };
  };
  const matchQuery = correlation(input.matchQuery, true), matchBody = correlation(input.matchBody, false);
  if (trigger.parameter && !Object.keys(matchQuery).length && !Object.keys(matchBody).length) reject('Parameterized triggers require request correlation to exclude stale/unrelated responses.');
  const timeoutMs = input.timeoutMs ?? 10000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 20000) reject('timeoutMs must be 500–20000.');
  return { strategy: 'INTERCEPT', endpoint: url.origin + url.pathname, method: candidate.method,
    bodyKind: candidate.requestEvidence?.bodyKind, apiEvidenceId: candidate.id, trigger: { ...trigger }, matchQuery, matchBody, timeoutMs };
}
export function interceptValues(source, values = {}) {
  const name = source.trigger.parameter;
  if (!object(values) || Object.keys(values).some(key => key !== name)
    || (name && (typeof values[name] !== 'string' || !values[name].trim() || values[name].length > 1000))) reject('Provide exactly the trigger parameter as a nonempty string of at most 1000 characters.');
  return { ...values };
}
