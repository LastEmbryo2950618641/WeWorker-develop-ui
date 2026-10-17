import { createHash } from 'node:crypto';
import { explorationError as fail, textArg } from './exploration-commands.js';
import { draftCommandId } from './generation-harness/package-draft.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const sensitive = /password|passwd|secret|cookie|authorization|credential|api.?key|csrf|session|token/i;
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw fail('INVALID_PAGE_SOURCE', 'Unsupported page source fields.');
}
const safeName = name => typeof name === 'string' && /^[a-zA-Z_$][a-zA-Z0-9_$-]{0,99}$/.test(name)
  && !['__proto__', 'prototype', 'constructor', 'window', 'globalThis', 'document', 'localStorage', 'sessionStorage'].includes(name) && !sensitive.test(name);

export function normalizePageSource(input) {
  if (input?.strategy === 'UI_SELECTOR') {
    keys(input, ['strategy', 'selector', 'emptySelector', 'fields', 'limit']);
    const selector = textArg(input.selector, 'selector', 1000);
    if (!object(input.fields) || !Object.keys(input.fields).length || Object.keys(input.fields).length > 30) throw fail('INVALID_PAGE_SOURCE', 'Provide 1–30 named DOM fields.');
    const fields = Object.fromEntries(Object.entries(input.fields).sort(([a], [b]) => a.localeCompare(b)).map(([name, field]) => {
      if (!safeName(name)) throw fail('INVALID_PAGE_SOURCE', 'Use public, portable output field names.');
      keys(field, ['selector', 'attribute', 'optional']);
      if (field.optional !== undefined && typeof field.optional !== 'boolean') throw fail('INVALID_PAGE_SOURCE', 'optional must be boolean.');
      if (field.attribute !== undefined && (!/^[a-z][a-z0-9:_-]{0,99}$/.test(field.attribute) || sensitive.test(field.attribute) || /^on/.test(field.attribute))) throw fail('INVALID_PAGE_SOURCE', 'Use a non-sensitive data attribute.');
      return [name, { ...(field.selector !== undefined ? { selector: textArg(field.selector, 'field selector', 1000) } : {}),
        ...(field.attribute ? { attribute: field.attribute } : {}), optional: field.optional === true }];
    }));
    const limit = input.limit ?? 200;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw fail('INVALID_PAGE_SOURCE', 'limit must be 1–1000.');
    return { strategy: input.strategy, selector, ...(input.emptySelector ? { emptySelector: textArg(input.emptySelector, 'emptySelector', 1000) } : {}), fields, limit };
  }
  if (input?.strategy === 'DOM_STATE') {
    keys(input, ['strategy', 'path', 'jsonSelector']);
    const path = input.path || [];
    if (!Array.isArray(path) || path.length > 16 || (!input.jsonSelector && !path.length)
      || path.some(key => !(safeName(key) || (typeof key === 'string' && /^\d{1,4}$/.test(key))))) throw fail('INVALID_PAGE_SOURCE', 'Use an array of public state property names or numeric indexes.');
    return { strategy: input.strategy, ...(input.jsonSelector ? { jsonSelector: textArg(input.jsonSelector, 'jsonSelector', 1000) } : {}), path };
  }
  throw fail('INVALID_PAGE_SOURCE', 'strategy must be DOM_STATE or UI_SELECTOR.');
}

export function pageObservation({ source, url, shape, reason }) {
  const page = new URL(url);
  if (page.pathname.includes(':id')) throw fail('PAGE_SOURCE_DYNAMIC_ROUTE', 'Dynamic page routes need explicit parameter design before generation.');
  const target = { expectedOrigin: page.origin, expectedPath: page.pathname };
  const id = 'page-v1-' + createHash('sha256').update(JSON.stringify({ ...target, source })).digest('hex').slice(0, 20);
  const clean = (value, depth = 0) => {
    if (depth > 8 || !object(value) || !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null', 'unknown'].includes(value.type)) return { type: 'unknown' };
    if (value.type === 'array') return { type: 'array', ...(Number.isSafeInteger(value.length) && value.length >= 0 ? { length: value.length } : {}), items: clean(value.items, depth + 1) };
    if (value.type === 'object') return { type: 'object', properties: Object.fromEntries(Object.entries(value.properties || {}).filter(([key]) => safeName(key)).slice(0, 100).map(([key, child]) => [key, clean(child, depth + 1)])) };
    return { type: value.type };
  };
  return { id, ...target, source, shape: clean(shape), reason: textArg(reason, 'reason'), observedAt: new Date().toISOString() };
}

export function pageSourceEvidence(observation) {
  return { version: 'page-source-v1', fingerprint: observation.id, strategy: observation.source.strategy,
    source: observation.source, expectedOrigin: observation.expectedOrigin, expectedPath: observation.expectedPath, reason: observation.reason,
    risk: { level: 'read', confidence: 0.95, evidence: ['observed_declarative_page_read'] } };
}

export function buildPageTool(site, tool, observation) {
  const name = `${site}.${tool.name}`, id = draftCommandId(tool.name);
  const payload = { source: observation.source, expectedOrigin: observation.expectedOrigin, expectedPath: observation.expectedPath };
  return { toolDefinition: { name, access: 'read', description: tool.purpose || `Read the observed ${observation.source.strategy} source on the current page.`,
    pageRoute: { origin: observation.expectedOrigin, pathname: observation.expectedPath },
    parameters: { type: 'object', properties: {}, additionalProperties: false }, generationSource: pageSourceEvidence(observation) },
    v2Content: `(function () {
  window.__webcliRegisterCommand(${JSON.stringify(id)}, async function (args = {}) {
    if (Object.keys(args).length) return { ok: false, error: 'This page read has no parameters. Author and verify parameter handling before using arguments.' };
    const reply = await chrome.runtime.sendMessage({ type: 'wecli_runtime_request', action: 'page_read', payload: ${JSON.stringify(payload)} });
    if (!reply?.ok) throw new Error(reply?.error?.message || 'Page read helper unavailable; update the browser extension.');
    return reply.result;
  });
})();\n` };
}
