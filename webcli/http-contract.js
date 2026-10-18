/** Versioned host HTTP contract. Extension and Toolkit keep their own runners. */
export function validateHttpContract(command) {
  const fail = message => { throw Object.assign(new Error(message), { code: 'INVALID_HTTP_CONTRACT' }); };
  if (command.runtime !== 'http') {
    if (command.http !== undefined) fail('http requires the HTTP runtime.');
    return;
  }
  const spec = command.http;
  if (!spec || ![1, 2].includes(spec.version) || !(spec.version === 1 ? ['PUBLIC_API', 'COOKIE_API'] : ['PUBLIC_API', 'COOKIE_API', 'AUTH_API']).includes(spec.strategy)
    || Object.keys(spec).some(key => !['version', 'strategy', 'origins', 'cookies', ...(spec.version === 2 ? ['auth'] : [])].includes(key))) fail('HTTP commands require a supported versioned strategy contract.');
  if (!Array.isArray(spec.origins) || !spec.origins.length || spec.origins.length > 16
    || new Set(spec.origins).size !== spec.origins.length) fail('HTTP origins must be 1–16 unique exact origins.');
  for (const origin of spec.origins) {
    let url;
    try { url = new URL(origin); } catch { /* Rejected below. */ }
    if (!url || !['https:', 'http:'].includes(url.protocol) || url.origin !== origin
      || url.username || url.password) fail('HTTP origins must be exact HTTP(S) origins without credentials or paths.');
  }
  const cookies = spec.cookies;
  if (spec.auth !== undefined) validateHttpAuth(spec.auth, spec.origins, fail);
  if (spec.strategy === 'AUTH_API' && spec.auth === undefined) fail('AUTH_API requires an explicit host authentication contract.');
  if (spec.strategy === 'PUBLIC_API') {
    if (cookies !== undefined || spec.auth !== undefined) fail('PUBLIC_API cannot declare credentials.');
    return;
  }
  if (spec.strategy === 'AUTH_API') {
    if (cookies !== undefined) fail('Use COOKIE_API to combine browser cookies with host authentication.');
    return;
  }
  if (!cookies || !spec.origins.includes(cookies.origin)
    || Object.keys(cookies).some(key => !['origin', 'names', 'csrf', ...(spec.version === 2 ? ['storeId', 'partitionKey'] : [])].includes(key))
    || !Array.isArray(cookies.names) || !cookies.names.length || cookies.names.length > 32
    || new Set(cookies.names).size !== cookies.names.length
    || cookies.names.some(name => typeof name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))) fail('COOKIE_API requires an allowed origin and explicit cookie names.');
  const csrf = cookies.csrf;
  if (csrf !== undefined && (!csrf || !cookies.names.includes(csrf.cookie)
    || typeof csrf.header !== 'string' || !/^x-[a-z0-9-]+$/i.test(csrf.header)
    || (csrf.decode !== undefined && typeof csrf.decode !== 'boolean')
    || Object.keys(csrf).some(key => !['cookie', 'header', 'decode'].includes(key)))) fail('CSRF must map a declared cookie to an X- header.');
  validateCookieScope(cookies, fail);
  if (csrf && httpAuthHeaders(spec.auth).includes(csrf.header.toLowerCase())) fail('CSRF and host authentication headers must be distinct.');
}

const headerToken = value => typeof value === 'string' && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value);
export const isHttpAuthHeader = name => headerToken(name) && !/^(?:cookie|set-cookie|proxy-authorization|host|connection|content-length|transfer-encoding|upgrade|proxy-.*|sec-.*|content-.*|accept-encoding|trailer|te)$/i.test(name);
export function httpAuthHeaders(auth) {
  if (!auth) return [];
  return [auth.header || 'authorization', auth.timestamp?.header, auth.nonce?.header].filter(Boolean).map(name => name.toLowerCase());
}
export function httpCredentialsCapability(spec) {
  return spec?.cookies ? (spec.version === 2 ? 'http_credentials_v2' : 'http_credentials_v1') : null;
}
export function validateCookieScope(cookies, fail) {
  if (cookies.storeId !== undefined && (typeof cookies.storeId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(cookies.storeId))) fail('Cookie storeId must be an explicit store identifier.');
  if (cookies.partitionKey !== undefined) {
    const key = cookies.partitionKey;
    let site;
    try { site = new URL(key?.topLevelSite); } catch { /* Rejected below. */ }
    if (!key || typeof key !== 'object' || Array.isArray(key) || Object.keys(key).some(name => !['topLevelSite', 'hasCrossSiteAncestor'].includes(name))
      || !site || !['https:', 'http:'].includes(site.protocol) || site.origin !== key.topLevelSite || site.username || site.password
      || typeof key.hasCrossSiteAncestor !== 'boolean') fail('Cookie partitionKey requires an exact topLevelSite origin and explicit hasCrossSiteAncestor.');
  }
}

function validateHttpAuth(auth, origins, fail) {
  const fields = { bearer: ['env'], header: ['env', 'header'], basic: ['usernameEnv', 'passwordEnv'],
    hmac: ['env', 'header', 'algorithm', 'encoding', 'canonical', 'separator', 'prefix', 'timestamp', 'nonce'] };
  if (!auth || typeof auth !== 'object' || Array.isArray(auth) || !Object.hasOwn(fields, auth.type)
    || !origins.includes(auth.origin) || Object.keys(auth).some(key => !['type', 'origin', ...fields[auth.type]].includes(key))) fail('Invalid scoped host authentication contract.');
  for (const key of auth.type === 'basic' ? ['usernameEnv', 'passwordEnv'] : ['env']) {
    if (typeof auth[key] !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(auth[key])) fail('Credentials must reference environment variable names, never values.');
  }
  if (['header', 'hmac'].includes(auth.type) && !isHttpAuthHeader(auth.header)) fail('Authentication requires a non-transport header.');
  if (auth.type !== 'hmac') return;
  if (!['sha256', 'sha512'].includes(auth.algorithm) || !['hex', 'base64'].includes(auth.encoding)
    || typeof auth.separator !== 'string' || auth.separator.length > 4 || /[\r\0]/.test(auth.separator)
    || (auth.prefix !== undefined && (typeof auth.prefix !== 'string' || auth.prefix.length > 64 || /[^\x20-\x7e]/.test(auth.prefix)))) fail('Invalid HMAC algorithm, encoding or canonical separator/prefix.');
  for (const field of ['timestamp', 'nonce']) {
    const value = auth[field];
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value) || !isHttpAuthHeader(value.header)
      || value.header.toLowerCase() === 'authorization' || Object.keys(value).some(key => !(field === 'timestamp' ? ['header', 'unit'] : ['header']).includes(key))
      || (field === 'timestamp' && !['seconds', 'milliseconds'].includes(value.unit)))) fail('Invalid HMAC timestamp or nonce header.');
  }
  const headers = httpAuthHeaders(auth);
  if (new Set(headers).size !== headers.length) fail('Authentication headers must be distinct.');
  if (!Array.isArray(auth.canonical) || !auth.canonical.length || auth.canonical.length > 32) fail('HMAC requires 1–32 explicit canonical fields.');
  for (const part of auth.canonical) {
    if (!part || typeof part !== 'object' || Array.isArray(part) || Object.keys(part).length !== 1) fail('Invalid HMAC canonical field.');
    if (Object.hasOwn(part, 'field')) {
      if (!['method', 'origin', 'pathQuery', 'bodySha256', 'timestamp', 'nonce'].includes(part.field)
        || (['timestamp', 'nonce'].includes(part.field) && !auth[part.field])) fail('Unknown or unavailable HMAC canonical field.');
    } else if (Object.hasOwn(part, 'header')) {
      if (!headerToken(part.header) || /^(?:cookie|authorization|proxy-authorization)$/i.test(part.header)
        || part.header.toLowerCase() === auth.header.toLowerCase()) fail('Invalid HMAC canonical header.');
    } else if (!Object.hasOwn(part, 'literal') || typeof part.literal !== 'string' || part.literal.length > 1024) fail('Invalid HMAC canonical literal.');
  }
}
