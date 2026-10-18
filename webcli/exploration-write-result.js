import { explorationError as fail } from './exploration-commands.js';
import { normalizeVerificationCases } from './exploration-verification.js';
import { assertReadRequest } from './exploration-host.js';

const invalid = () => { throw fail('INVALID_WRITE_CASE', 'Result readback requires one fixed same-origin :id path, publicId:true, exact public response/identity paths and content assertions.'); };
const sensitive = /password|passwd|secret|cookie|authorization|token|credential|api.?key|csrf|session/i;
const parts = path => path.split('.');
function checkPath(path) {
  if (typeof path !== 'string' || path.length > 200 || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(path)
    || parts(path).length > 8 || parts(path).some(key => sensitive.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key))) invalid();
}
function valueAt(value, path) {
  for (const key of parts(path)) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

/** Only the explicitly reviewed public identifier can survive the response. */
export function resolveWriteResult(spec, response, origin) {
  const id = valueAt(response, spec.responsePath);
  if (typeof id !== 'string' || !id || id.length > 512 || id === '.' || id === '..'
    || !/^[\p{L}\p{N}_.-]+$/u.test(id)) throw fail('WRITE_RESULT_ID_INVALID', 'The actual write response lacks a safe public string identifier. No resource URL was guessed.');
  const url = new URL(spec.url);
  url.pathname = '/' + url.pathname.slice(1).split('/').map(part => part === ':id' ? encodeURIComponent(id) : part).join('/');
  assertReadRequest({ url: url.href }, origin, []);
  return { id, url: url.href };
}

export function normalizeWriteResult(input, mockResponse, origin) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['url', 'publicId', 'responsePath', 'identityPath', 'expect'].includes(key)) || input.publicId !== true) invalid();
  checkPath(input.responsePath); checkPath(input.identityPath);
  let url;
  try { url = new URL(input.url); } catch { invalid(); }
  if (url.origin !== origin || url.username || url.password || url.search || url.hash || input.url !== url.href
    || url.pathname.split('/').filter(part => part === ':id').length !== 1) invalid();
  // An example ID validates the fixed read route without making a network call.
  const expect = normalizeVerificationCases([{ id: 'result', args: {}, expect: input.expect }])[0].expect;
  if (!Object.keys(expect.equals || {}).some(key => {
    const canonical = key.replace(/^\$\.?/, '').split('.').filter(Boolean).join('.');
    return canonical && canonical !== input.identityPath && !canonical.includes('*');
  })) invalid();
  const spec = { url: url.href, publicId: true, responsePath: input.responsePath, identityPath: input.identityPath, expect };
  try { resolveWriteResult(spec, mockResponse, origin); } catch { invalid(); }
  return spec;
}

export function writeResultIdentityMatches(value, spec, id) {
  return valueAt(value, spec.identityPath) === id;
}

export function savedWriteResult(execution) {
  const spec = execution.effect.resultReadback;
  if (!execution.resultBinding) throw fail('WRITE_RESULT_ID_UNAVAILABLE', 'No durable response identifier is available. Inspect the service independently; never repeat the write to recover its ID.');
  // Reconstruct rather than accepting a persisted arbitrary URL; validate again
  // before either transport or credential resolution can observe the target.
  const origin = new URL(spec.url).origin;
  if (!(execution.page ? [execution.page.route.origin] : execution.http.origins).includes(origin)) throw fail('HTTP_ORIGIN_DENIED', 'Result readback origin is not declared.');
  return resolveWriteResult({ ...spec, responsePath: 'id' }, execution.resultBinding, origin);
}
