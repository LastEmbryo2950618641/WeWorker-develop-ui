const sensitive = /authorization|cookie|token|password|passwd|secret|credential|api.?key|csrf|xsrf|session|ticket|signature|^w_rid$|^wts$/i;
export function browserResponseEvidence(body) {
  const shape = (value, depth = 0) => {
    if (depth > 8) return { type: 'unknown' };
    if (value === null) return { type: 'null' };
    if (Array.isArray(value)) return { type: 'array', items: value.length ? shape(value[0], depth + 1) : { type: 'unknown' } };
    if (typeof value === 'object') return { type: 'object', properties: Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, value]) => [key, shape(value, depth + 1)])) };
    return { type: typeof value };
  };
  try {
    const bodyShape = shape(JSON.parse(body));
    return { version: 'response-evidence-v1', bodyKind: 'json', bodyShape, bodyKeys: Object.keys(bodyShape.properties || {}), bodyFullSize: body.length, bodyTruncated: false, bodyOmitted: false };
  } catch { return undefined; }
}
export function browserNetworkUrl(value) {
  try {
    const url = new URL(value); url.username = ''; url.password = ''; url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (sensitive.test(key)) url.searchParams.set(key, '[redacted]');
    return url.href;
  } catch { return ''; }
}
export function browserNetworkBody(value) {
  const clean = (item, depth = 0) => {
    if (depth > 12) return '[depth limit]';
    if (Array.isArray(item)) return item.slice(0, 100).map(value => clean(value, depth + 1));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).slice(0, 200).map(([key, value]) => [key, sensitive.test(key) ? '[redacted]' : clean(value, depth + 1)]));
    return typeof item === 'string' ? item.slice(0, 8000) : item;
  };
  if (!value) return '';
  try { return clean(typeof value === 'string' ? JSON.parse(value) : value); }
  catch {
    // Truncated JSON cannot be safely redacted by field; do not return a prefix.
    return { omitted: true, reason: 'Non-JSON or truncated body. Use page inspection for non-JSON content.' };
  }
}
