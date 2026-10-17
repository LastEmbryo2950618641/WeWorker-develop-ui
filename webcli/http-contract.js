/** Versioned host HTTP contract. Extension and Toolkit keep their own runners. */
export function validateHttpContract(command) {
  const fail = message => { throw Object.assign(new Error(message), { code: 'INVALID_HTTP_CONTRACT' }); };
  if (command.runtime !== 'http') {
    if (command.http !== undefined) fail('http requires the HTTP runtime.');
    return;
  }
  const spec = command.http;
  if (!spec || spec.version !== 1 || !['PUBLIC_API', 'COOKIE_API'].includes(spec.strategy)
    || Object.keys(spec).some(key => !['version', 'strategy', 'origins', 'cookies'].includes(key))) fail('HTTP commands require a version 1 strategy contract.');
  if (!Array.isArray(spec.origins) || !spec.origins.length || spec.origins.length > 16
    || new Set(spec.origins).size !== spec.origins.length) fail('HTTP origins must be 1–16 unique exact origins.');
  for (const origin of spec.origins) {
    let url;
    try { url = new URL(origin); } catch { /* Rejected below. */ }
    if (!url || !['https:', 'http:'].includes(url.protocol) || url.origin !== origin
      || url.username || url.password) fail('HTTP origins must be exact HTTP(S) origins without credentials or paths.');
  }
  const cookies = spec.cookies;
  if (spec.strategy === 'PUBLIC_API') {
    if (cookies !== undefined) fail('PUBLIC_API cannot declare credentials.');
    return;
  }
  if (!cookies || !spec.origins.includes(cookies.origin)
    || Object.keys(cookies).some(key => !['origin', 'names', 'csrf'].includes(key))
    || !Array.isArray(cookies.names) || !cookies.names.length || cookies.names.length > 32
    || new Set(cookies.names).size !== cookies.names.length
    || cookies.names.some(name => typeof name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))) fail('COOKIE_API requires an allowed origin and explicit cookie names.');
  const csrf = cookies.csrf;
  if (csrf !== undefined && (!csrf || !cookies.names.includes(csrf.cookie)
    || typeof csrf.header !== 'string' || !/^x-[a-z0-9-]+$/i.test(csrf.header)
    || (csrf.decode !== undefined && typeof csrf.decode !== 'boolean')
    || Object.keys(csrf).some(key => !['cookie', 'header', 'decode'].includes(key)))) fail('CSRF must map a declared cookie to an X- header.');
}
