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
const publicResultPath = value => typeof value === 'string' && value.length <= 200
  && /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*$/.test(value)
  && !/password|secret|token|cookie|auth|session|csrf|constructor|prototype/i.test(value);
const readPath = value => !/approve|reject|delete|remove|update|edit|submit|create|add|cancel|publish|confirm|apply|save|write|mutation|session|logout|mark.?read|审批|批准|驳回|删除|修改|提交|创建|新增|取消|发布|确认|更新/i.test(value);
export function normalizeHashNavigation(input, baseParameters = []) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['template', 'pathParameters', 'queryParameters', 'matchResult', 'freshnessPath', 'sameTarget'].includes(key))) throw new Error('Declare an explicit hash template, bindings, business correlation and freshness.');
  const { template, freshnessPath, sameTarget } = input;
  if (typeof template !== 'string' || template.length > 1000 || !/^(?:\/)?[a-zA-Z0-9_:-]+(?:\/[a-zA-Z0-9_:-]+)*$/.test(template)
    || !readPath(template) || !publicResultPath(freshnessPath) || sameTarget !== 'reload') throw new Error('Use a public read-only fragment and explicitly allow sameTarget reload.');
  const parts = template.replace(/^\//, '').split('/'), names = new Set(baseParameters.map(item => item.name)), indexes = new Set();
  const paths = input.pathParameters ?? [];
  if (!Array.isArray(paths) || paths.length > 16) throw new Error('Declare at most 16 hash path bindings.');
  const pathParameters = paths.map(binding => {
    if (!binding || Object.keys(binding).some(key => !['segmentIndex', 'name', 'description'].includes(key))) throw new Error('Invalid hash path binding.');
    const { segmentIndex, name, description } = binding;
    if (!Number.isSafeInteger(segmentIndex) || parts[segmentIndex] !== ':id' || indexes.has(segmentIndex) || !publicName(name) || names.has(name)
      || typeof description !== 'string' || !description.trim() || description.length > 500) throw new Error('Bind each hash :id once to a unique public parameter.');
    indexes.add(segmentIndex); names.add(name); return { segmentIndex, name, description };
  }).sort((a, b) => a.segmentIndex - b.segmentIndex);
  if (parts.some((part, index) => part.includes(':') && (part !== ':id' || !indexes.has(index)))) throw new Error('Each hash placeholder must be bound.');
  const queryParameters = normalizeNavigationQueryParameters(input.queryParameters, [...baseParameters, ...pathParameters]);
  const all = [...baseParameters, ...pathParameters, ...queryParameters];
  if (!pathParameters.length && !queryParameters.length) throw new Error('Declare at least one hash parameter.');
  const matchResult = input.matchResult;
  if (!matchResult || typeof matchResult !== 'object' || Array.isArray(matchResult) || Object.keys(matchResult).length !== all.length
    || Object.entries(matchResult).some(([path, name]) => !publicResultPath(path) || path === freshnessPath || !all.some(item => item.name === name))
    || new Set(Object.values(matchResult)).size !== all.length) throw new Error('Correlate every navigation parameter with a distinct business result path.');
  return { template, pathParameters, ...(queryParameters.length ? { queryParameters } : {}), matchResult: Object.fromEntries(Object.entries(matchResult).sort(([a], [b]) => a.localeCompare(b))), freshnessPath, sameTarget };
}
export function appendNavigationHash(url, hash, values) {
  if (!hash) return url;
  const parts = hash.template.replace(/^\//, '').split('/');
  for (const { segmentIndex, name } of hash.pathParameters) {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (typeof value !== 'string' || !value.trim() || value.length > 512 || ['.', '..', ':id', '<value>'].includes(value)
      || /[/\\%\u0000-\u001f\u007f]/.test(value)) throw new Error('Hash path parameters must be explicit public single-segment strings.');
    parts[segmentIndex] = encodeURIComponent(value);
  }
  const route = (hash.template.startsWith('/') ? '/' : '') + parts.join('/');
  if (!readPath(decodeURIComponent(route))) throw new Error('Hash navigation must target a read-only route.');
  const queries = appendNavigationQuery(new URL('https://example.com'), hash.queryParameters || [], values).search;
  url.hash = route + queries;
  return url;
}
export function navigationResultValue(data, path) {
  for (const key of path.split('.')) data = data && Object.hasOwn(data, key) ? data[key] : undefined;
  return data;
}
export const navigationParameters = source => [...(source.pathParameters || []), ...(source.queryParameters || []), ...(source.hashNavigation?.pathParameters || []), ...(source.hashNavigation?.queryParameters || [])];
export const usesNavigationQuery = source => Boolean(source?.queryParameters?.length || source?.steps?.some(step => usesNavigationQuery(step.query)));
export const usesNavigationHash = source => Boolean(source?.hashNavigation || source?.steps?.some(step => usesNavigationHash(step.query)));
