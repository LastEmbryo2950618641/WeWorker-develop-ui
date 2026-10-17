import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { readPackageDirectory, adapterError } from './adapter-package-files.js';
import { validateHttpContract, httpAuthHeaders } from './http-contract.js';
import { createHttpAuthenticator } from './http-auth.js';
import { httpWorkerMain } from './http-worker.js';

const MAX_BYTES = 4 * 1024 * 1024;
const deniedHeaders = /^(?:cookie|authorization|proxy-authorization|host|connection|content-length|transfer-encoding|upgrade|proxy-.*|sec-.*)$/i;
const fail = (code, message) => adapterError('HTTP_' + code, message);

/** Execute a verified package snapshot. Credentials exist only in the host request closure. */
export async function runHttpTool(match, args = {}, options = {}) {
  const pkg = readPackageDirectory(match.adapter.root);
  if (match.adapter.digest && pkg.digest !== match.adapter.digest) throw fail('STALE_PACKAGE', 'Adapter changed before HTTP execution.');
  const command = pkg.commands.find(entry => entry.id === match.command.id);
  if (!command || command.runtime !== 'http') throw fail('COMMAND_UNAVAILABLE', 'HTTP command is unavailable.');
  validateHttpContract(command);
  if ((command.requires_confirmation ?? command.safety === 'write') && args.__confirmed !== true) throw fail('CONFIRMATION_REQUIRED', 'Explicit confirmation is required for this command.');
  if (options.signal?.aborted) throw fail('ABORTED', 'HTTP operation cancelled.');
  const spec = command.http;
  const controller = new AbortController();
  const secrets = new Set();
  const authenticate = createHttpAuthenticator(spec, secrets);
  const managedHeaders = [...httpAuthHeaders(spec.auth), ...(spec.cookies?.csrf ? [spec.cookies.csrf.header.toLowerCase()] : [])];
  const redact = value => {
    if (typeof value === 'string') {
      for (const secret of [...secrets].sort((a, b) => b.length - a.length)) value = value.split(secret).join('[REDACTED]');
      return value;
    }
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redact(item)]));
    return value;
  };
  let requests = 0;
  const request = async (input, redirects = 0) => {
    if (++requests > 50) throw fail('REQUEST_LIMIT', 'HTTP command exceeded 50 requests.');
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['url', 'method', 'headers', 'json', 'body', 'response'].includes(key))) throw fail('INVALID_REQUEST', 'Invalid HTTP request fields.');
    let url;
    try { url = new URL(input.url); } catch { throw fail('INVALID_URL', 'Request needs an absolute HTTP(S) URL.'); }
    if (!spec.origins.includes(url.origin) || url.username || url.password || url.hash) throw fail('ORIGIN_DENIED', 'Request origin is not declared or the URL contains credentials/fragments.');
    const method = input.method || 'GET';
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      || (command.safety !== 'write' && !['GET', 'HEAD', 'POST'].includes(method))) throw fail('METHOD_DENIED', 'HTTP method is not permitted for this command.');
    const headers = new Headers();
    if (input.headers !== undefined && (!input.headers || typeof input.headers !== 'object' || Array.isArray(input.headers))) throw fail('INVALID_HEADERS', 'Headers must be an object.');
    for (const [name, value] of Object.entries(input.headers || {})) {
      if (deniedHeaders.test(name) || managedHeaders.includes(name.toLowerCase()) || typeof value !== 'string' || /[\r\n\0]/.test(value)) throw fail('INVALID_HEADERS', 'Credential and transport headers must not be authored in a command.');
      try { headers.set(name, value); } catch { throw fail('INVALID_HEADERS', 'Invalid request header.'); }
    }
    let body = input.body;
    if (input.json !== undefined) {
      if (body !== undefined) throw fail('INVALID_BODY', 'Choose json or body.');
      body = JSON.stringify(input.json); headers.set('content-type', 'application/json');
    }
    if (body !== undefined && (typeof body !== 'string' || Buffer.byteLength(body) > MAX_BYTES || ['GET', 'HEAD'].includes(method))) throw fail('INVALID_BODY', 'Request body is invalid or exceeds 4 MiB.');
    if (input.response !== undefined && !['json', 'text'].includes(input.response)) throw fail('INVALID_REQUEST', 'response must be json or text.');
    if (spec.cookies && url.origin === spec.cookies.origin) {
      if (!options.resolveCookies) throw fail('CREDENTIALS_REQUIRED', 'COOKIE_API requires a selected browser profile.');
      let cookies;
      try { cookies = await options.resolveCookies({ url: url.href, names: spec.cookies.names,
        ...(spec.version === 2 ? { version: 2, ...(spec.cookies.storeId !== undefined ? { storeId: spec.cookies.storeId } : {}),
          ...(spec.cookies.partitionKey ? { partitionKey: spec.cookies.partitionKey } : {}) } : {}) }); }
      catch (error) { throw fail(error.code === 'PROFILE_DISCONNECTED' ? 'PROFILE_DISCONNECTED' : 'CREDENTIALS_UNAVAILABLE', 'Cannot read declared credentials from the selected browser connection.'); }
      if (controller.signal.aborted) throw fail('ABORTED', 'HTTP operation cancelled.');
      if (!Array.isArray(cookies) || spec.cookies.names.some(name => cookies.filter(cookie => cookie.name === name).length !== 1)) throw fail('CREDENTIALS_MISSING', 'Declared cookies are missing or ambiguous. Restore the selected browser session.');
      const selected = spec.cookies.names.map(name => cookies.find(cookie => cookie.name === name));
      for (const cookie of selected) {
        if (typeof cookie.value !== 'string' || !cookie.value || /[;\r\n\0]/.test(cookie.value)) throw fail('CREDENTIALS_INVALID', 'A declared cookie is empty or invalid.');
        secrets.add(cookie.value);
      }
      headers.set('cookie', selected.map(cookie => cookie.name + '=' + cookie.value).join('; '));
      if (spec.cookies.csrf) {
        const csrf = spec.cookies.csrf;
        let value = selected.find(cookie => cookie.name === csrf.cookie).value;
        try { if (csrf.decode) value = decodeURIComponent(value); headers.set(csrf.header, value); }
        catch { throw fail('CREDENTIALS_INVALID', 'CSRF cookie cannot be converted to a request header.'); }
        secrets.add(value);
      }
    }
    authenticate({ url, method, body, headers });
    let response;
    try {
      response = await (options.fetch || fetch)(url, { method, headers, body, redirect: 'manual', signal: controller.signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location || redirects >= 5) throw fail('REDIRECT', 'HTTP redirect is missing a location or exceeds five hops.');
        let next;
        try { next = new URL(location, url); } catch { throw fail('REDIRECT', 'Invalid HTTP redirect location.'); }
        if (!spec.origins.includes(next.origin) || next.username || next.password) throw fail('ORIGIN_DENIED', 'Redirect origin is not declared.');
        next.hash = '';
        const get = (response.status === 303 && method !== 'GET' && method !== 'HEAD') || ([301, 302].includes(response.status) && method === 'POST');
        const forwarded = { ...input, url: next.href, method: get ? 'GET' : method };
        if (get) {
          delete forwarded.body; delete forwarded.json;
          forwarded.headers = Object.fromEntries(Object.entries(input.headers || {}).filter(([key]) => !/^content-/i.test(key)));
        }
        // Recheck exact origin and resolve cookies for the new URL. Injected
        // credential headers never become part of the forwarded command input.
        return request(forwarded, redirects + 1);
      }
      if (!response.ok) { await response.body?.cancel(); throw fail([401, 403].includes(response.status) ? 'AUTH_REQUIRED' : 'STATUS', 'HTTP endpoint returned status ' + response.status + '.'); }
      const chunks = []; let size = 0;
      if (response.body) for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_BYTES) { throw fail('RESPONSE_LIMIT', 'HTTP response exceeds 4 MiB.'); }
        chunks.push(chunk);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      if (input.response === 'text') return redact(text);
      if (method === 'HEAD' || response.status === 204) return null;
      try { return redact(JSON.parse(text)); } catch { throw fail('INVALID_JSON', 'HTTP endpoint did not return valid JSON.'); }
    } catch (error) {
      if (error.code?.startsWith('HTTP_')) throw error;
      throw fail(controller.signal.aborted ? 'ABORTED' : 'NETWORK', 'HTTP request failed. No request was retried.');
    }
  };
  const worker = new Worker('(' + httpWorkerMain.toString() + ')()', { eval: true, env: {},
    resourceLimits: { maxOldGenerationSizeMb: 64 },
    workerData: { module: command.module, args, files: Object.fromEntries([...pkg.files]
      .filter(([name]) => name.startsWith('http/')).map(([name, bytes]) => [name, bytes.toString('utf8')])) } });
  const traceID = options.traceID || randomUUID();
  let finished = false;
  try {
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(fail('TIMEOUT', 'HTTP command timed out. No request was retried.')), options.timeoutMs || 30_000);
      const abort = () => reject(fail('ABORTED', 'HTTP operation cancelled.'));
      options.signal?.addEventListener('abort', abort, { once: true });
      worker.once('error', () => reject(fail('COMMAND_FAILED', 'HTTP worker failed.')));
      worker.once('exit', () => reject(fail('COMMAND_FAILED', 'HTTP worker exited without a result.')));
      worker.on('message', async message => {
        if (finished) return;
        if (message.type === 'result') resolve(redact(message.result));
        else if (message.type === 'failure') reject(adapterError(message.error.code, message.error.message));
        else if (message.type === 'request') {
          try { const result = await request(message.options); if (!finished) worker.postMessage({ id: message.id, result }); }
          catch (error) { if (!finished) worker.postMessage({ id: message.id, error: { code: error.code || 'HTTP_REQUEST_FAILED', message: 'HTTP request failed under its declared contract.' } }); }
        }
      });
      worker.once('exit', () => { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); });
    });
    return { result, traceID, exitCode: 0 };
  } finally {
    finished = true; controller.abort(); await worker.terminate(); secrets.clear();
  }
}
