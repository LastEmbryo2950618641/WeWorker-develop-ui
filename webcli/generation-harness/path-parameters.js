// URL path bindings are authored explicitly. Captured identifiers never become
// defaults, and each argument occupies exactly one segment of the observed URL.
export function normalizePathParameters(candidate, input) {
  const url = new URL(candidate.url, 'https://example.invalid');
  const segments = url.pathname.slice(1).split('/');
  const placeholders = segments.flatMap((part, index) => part === ':id' ? [index] : []);
  if (input === undefined && !placeholders.length) return [];
  if (!Array.isArray(input) || !input.length || input.length > 16) throw new Error('Declare 1–16 pathParameters with segmentIndex, name and description.');
  const indexes = new Set(), names = new Set();
  const queryNames = new Set(url.searchParams.keys());
  const bodyNames = new Set(candidate.requestEvidence?.bodyKeys || candidate.sourceEvidence?.bodyKeys || []);
  const result = input.map(binding => {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)
      || Object.keys(binding).some(key => !['segmentIndex', 'name', 'description'].includes(key))) throw new Error('Unsupported path parameter fields.');
    const { segmentIndex, name, description } = binding;
    if (!Number.isSafeInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= segments.length || !segments[segmentIndex] || indexes.has(segmentIndex)) throw new Error('Path segmentIndex must identify a unique nonempty segment (zero-based after the leading slash).');
    if (typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)
      || /password|passwd|secret|cookie|authorization|credential|api.?key|csrf|session|token/i.test(name)
      || ['constructor', 'prototype', '__proto__'].includes(name) || names.has(name) || queryNames.has(name) || bodyNames.has(name)) throw new Error('Use unique public path parameter names distinct from query/body fields.');
    if (typeof description !== 'string' || !description.trim() || description.length > 500) throw new Error('Describe the meaning of each path parameter.');
    indexes.add(segmentIndex); names.add(name);
    return { segmentIndex, name, description };
  }).sort((a, b) => a.segmentIndex - b.segmentIndex);
  if (placeholders.some(index => !indexes.has(index))) throw new Error('Every :id segment needs an explicit path parameter.');
  return result;
}

/** Self-contained browser function; inlined into each generated command. */
export function resolvePathRequest(endpoint, bindings, args) {
  const url = new URL(endpoint);
  const segments = url.pathname.slice(1).split('/');
  const params = { ...args };
  const queryKeys = [...url.searchParams.keys()];
  url.search = '';
  for (const { segmentIndex, name } of bindings) {
    const value = Object.hasOwn(params, name) ? params[name] : undefined;
    if (typeof value !== 'string' || !value.trim() || value.length > 512 || value === '.' || value === '..'
      || value === ':id' || value === '<value>' || /[/\\%\u0000-\u001f\u007f]/.test(value)) {
      throw Object.assign(new Error(`Path parameter ${name} must be a nonempty string containing one identifier, without slashes, percent escapes or dot traversal.`), { code: 'INVALID_PATH_PARAMETER' });
    }
    try { segments[segmentIndex] = encodeURIComponent(value); }
    catch { throw Object.assign(new Error(`Path parameter ${name} must be valid Unicode.`), { code: 'INVALID_PATH_PARAMETER' }); }
    delete params[name];
  }
  for (const name of queryKeys) {
    if (!Object.hasOwn(params, name)) continue;
    const value = params[name];
    if (value !== undefined && value !== null) {
      if (!['string', 'number', 'boolean'].includes(typeof value)) throw Object.assign(new Error(`Query parameter ${name} must be a scalar.`), { code: 'INVALID_QUERY_PARAMETER' });
      url.searchParams.set(name, String(value));
    }
    delete params[name];
  }
  url.pathname = '/' + segments.join('/');
  return { url: url.href, params };
}
