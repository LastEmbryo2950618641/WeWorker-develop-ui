import { createHash, createHmac, randomBytes } from 'node:crypto';
import { adapterError } from './adapter-package-files.js';

const fail = code => adapterError('HTTP_' + code, 'Declared host authentication is missing or invalid. Check the executing host environment.');

/** Capture only declared names. This closure and its credentials never enter the Worker. */
export function createHttpAuthenticator(spec, secrets, env = process.env) {
  const auth = spec.auth;
  if (!auth) return () => {};
  const read = name => {
    const value = Object.hasOwn(env, name) ? env[name] : undefined;
    if (typeof value !== 'string' || !value) throw fail('CREDENTIALS_MISSING');
    if (!value.trim() || value.length > 16384 || /[\r\n\0]/.test(value)) throw fail('CREDENTIALS_INVALID');
    secrets.add(value);
    return value;
  };
  let credential;
  if (auth.type === 'basic') {
    const username = read(auth.usernameEnv), password = read(auth.passwordEnv);
    if (username.includes(':')) throw fail('CREDENTIALS_INVALID');
    const pair = username + ':' + password;
    secrets.add(pair);
    credential = 'Basic ' + Buffer.from(pair, 'utf8').toString('base64');
    secrets.add(credential.slice(6));
  } else credential = read(auth.env);
  return ({ url, method, body, headers }) => {
    if (url.origin !== auth.origin) return;
    let value = credential;
    if (auth.type === 'bearer') value = 'Bearer ' + credential;
    if (auth.type === 'hmac') {
      const timestamp = auth.timestamp ? String(auth.timestamp.unit === 'seconds' ? Math.floor(Date.now() / 1000) : Date.now()) : '';
      const nonce = auth.nonce ? randomBytes(16).toString('hex') : '';
      if (auth.timestamp) headers.set(auth.timestamp.header, timestamp);
      if (auth.nonce) headers.set(auth.nonce.header, nonce);
      const fields = { method, origin: url.origin, pathQuery: url.pathname + url.search,
        bodySha256: createHash('sha256').update(body || '').digest('hex'), timestamp, nonce };
      const canonical = auth.canonical.map(part => {
        if (Object.hasOwn(part, 'literal')) return part.literal;
        if (part.field) return fields[part.field];
        if (!headers.has(part.header)) throw fail('SIGNING_INPUT_MISSING');
        return headers.get(part.header);
      }).join(auth.separator);
      const signature = createHmac(auth.algorithm, credential).update(canonical).digest(auth.encoding);
      secrets.add(signature);
      value = (auth.prefix || '') + signature;
    }
    secrets.add(value);
    try {
      headers.set(auth.header || 'authorization', value);
      const normalized = headers.get(auth.header || 'authorization');
      if (!normalized) throw fail('CREDENTIALS_INVALID');
      secrets.add(normalized);
      // Header normalization removes surrounding whitespace. A server may echo
      // only the token, without its scheme, so retain that representation too.
      if (auth.type === 'header' || auth.type === 'bearer') secrets.add(credential.trim());
    }
    catch { throw fail('CREDENTIALS_INVALID'); }
  };
}
