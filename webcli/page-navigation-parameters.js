// Query values are explicit public parameters, never defaults from captured URLs.
const publicName = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(value)
  && !/password|passwd|secret|cookie|auth|credential|api.?key|csrf|session|token|signature|constructor|prototype/i.test(value);
const actionKey = /^(?:action|op|operation|method|command|cmd|redirect|redirect_uri|return_url)$/i;
export function normalizeNavigationQueryParameters(input, paths = []) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || !input.length || input.length > 16) throw new Error('Declare 1–16 public queryParameters.');
  const names = new Set(paths.map(item => item.name)), keys = new Set();
  return input.map(binding => {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)
      || Object.keys(binding).some(key => !['name', 'queryKey', 'description'].includes(key))) throw new Error('Query bindings use name, queryKey and description only.');
    const { name, queryKey, description } = binding;
    if (!publicName(name) || !publicName(queryKey) || actionKey.test(queryKey) || names.has(name) || keys.has(queryKey)) throw new Error('Use unique public query keys and parameter names, without credential, action or redirect selectors.');
    if (typeof description !== 'string' || !description.trim() || description.length > 500) throw new Error('Describe each public query parameter.');
    names.add(name); keys.add(queryKey); return { name, queryKey, description };
  }).sort((a, b) => a.queryKey < b.queryKey ? -1 : a.queryKey > b.queryKey ? 1 : 0);
}
export function appendNavigationQuery(url, bindings, values) {
  for (const { name, queryKey } of bindings) {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (typeof value !== 'string' || !value.trim() || value.length > 512 || [':id', '<value>'].includes(value)
      || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Query parameters must be explicit nonempty public strings up to 512 characters.');
    try { encodeURIComponent(value); } catch { throw new Error('Query parameters must be valid Unicode.'); }
    url.searchParams.set(queryKey, value);
  }
  return url;
}
export const navigationParameters = source => [...(source.pathParameters || []), ...(source.queryParameters || [])];
export const usesNavigationQuery = source => Boolean(source?.queryParameters?.length || source?.steps?.some(step => usesNavigationQuery(step.query)));
