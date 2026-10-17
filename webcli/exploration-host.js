import { createHash, randomUUID } from 'node:crypto';
import { explorationError as fail, textArg } from './exploration-commands.js';
import { validateHttpContract } from './http-contract.js';
import { createHttpClient } from './http-client.js';
import { extractExplorationEvidence } from './exploration-evidence.js';
import { buildApiSourceEvidence } from './generation-harness/source-evidence.js';
import { discoverOpenApi } from './exploration-openapi.js';

export function startHostExploration(service, args) {
  if (args.tabId !== undefined) throw fail('INVALID_ARGUMENT', 'HTTP exploration does not accept a browser tab.');
  const goal = textArg(args.goal, 'goal'), requestId = textArg(args.requestId, 'requestId', 100);
  const origin = textArg(args.origin, 'origin', 2000);
  if (args.allowedOrigins !== undefined && !Array.isArray(args.allowedOrigins)) throw fail('INVALID_ARGUMENT', 'allowedOrigins must be an array.');
  const http = { version: args.auth ? 2 : 1, strategy: args.auth ? 'AUTH_API' : 'PUBLIC_API',
    origins: [...new Set([origin, ...(args.allowedOrigins || [])])].sort(), ...(args.auth !== undefined ? { auth: args.auth } : {}) };
  validateHttpContract({ runtime: 'http', http });
  const signature = createHash('sha256').update(JSON.stringify({ mode: 'http', goal, origin, http })).digest('hex');
  const previous = [...service.runs.values()].find(run => run.requestId === requestId);
  if (previous) {
    if (previous.signature !== signature) throw fail('REQUEST_CONFLICT', 'requestId was already used with different arguments.');
    return service.summary(previous);
  }
  if (service.runs.size >= 200) throw fail('TASK_LIMIT', 'Exploration task limit reached.');
  const now = new Date().toISOString();
  const run = { schemaVersion: 1, mode: 'http', taskId: 'http-' + randomUUID(), requestId, signature, goal, origin, http,
    tabId: null, siteKey: new URL(origin).hostname, allowedOrigins: http.origins.filter(value => value !== origin),
    createdAt: now, updatedAt: now, candidates: [], discoveries: [], events: [], sequence: 0 };
  service.update(run, 'evidence_ready', 'HTTP task created. Discover a documented API or request an explicit read endpoint; no request has been sent.');
  service.runs.set(run.taskId, run);
  return service.summary(run);
}

export function assertReadRequest(request, origin, allowedOrigins) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw fail('INVALID_ARGUMENT', 'Provide an explicit HTTP request object.');
  let url;
  try { url = new URL(request.url); } catch { throw fail('INVALID_ARGUMENT', 'Request URL must be absolute HTTP(S).'); }
  if (url.origin !== origin && !allowedOrigins.includes(url.origin)) throw fail('HTTP_ORIGIN_DENIED', 'Request origin is not declared by this task.');
  if ([...url.searchParams.keys()].some(key => /token|cookie|auth|password|secret|session|credential|api.?key|csrf|ticket/i.test(key))) throw fail('CREDENTIAL_INPUT_DENIED', 'Use a host auth contract instead of credential query parameters.');
  let body = request.json;
  if (body === undefined && typeof request.body === 'string') {
    try { body = JSON.parse(request.body); } catch { body = Object.fromEntries(new URLSearchParams(request.body)); }
  }
  const selectors = [...url.searchParams, ...Object.entries(body && typeof body === 'object' && !Array.isArray(body) ? body : {})];
  if (selectors.some(([key, value]) => /^(?:action|operation|op|method|_method)$/i.test(key)
    && typeof value === 'string' && /delete|remove|update|create|submit|publish|save|cancel|approve|reject|put|patch|mutation/i.test(value))) throw fail('READ_ONLY_REQUIRED', 'Mutation operation selectors cannot be dispatched by HTTP exploration.');
  const candidate = extractExplorationEvidence({ entries: [{ url: url.href, method: request.method || 'GET',
    requestBody: request.json !== undefined ? JSON.stringify(request.json) : request.body,
    requestContentType: request.json !== undefined ? 'application/json' : new Headers(request.headers || {}).get('content-type') || '',
    status: 200, responseContentType: 'application/json', responsePreview: '{}' }] }, origin, allowedOrigins)[0];
  if (!candidate || !['GET', 'POST'].includes(candidate.method) || candidate.risk.level !== 'read'
    || (candidate.method === 'POST' && !['json', 'form'].includes(candidate.requestEvidence.bodyKind))) throw fail('READ_ONLY_REQUIRED', 'Only evidenced GET or JSON/form read queries can be explored. Mutation and unresolved operations are not dispatched.');
}

export function collectHostEvidence(service, run, args, discovery) {
  const reason = textArg(args.reason, 'reason');
  const request = discovery ? { url: textArg(args.url, 'url', 4000) } : args.request;
  assertReadRequest(request, run.origin, run.allowedOrigins);
  if (request.response !== undefined && request.response !== 'json') throw fail('INVALID_ARGUMENT', 'Exploration requires a JSON response.');
  if ((run.requestCount || 0) >= 100) throw fail('REQUEST_LIMIT', 'This task has used 100 explicit discovery/request operations. Start another task for additional evidence.');
  // launch persists the budget before dispatch, including interrupted operations.
  run.requestCount = (run.requestCount || 0) + 1;
  return service.launch(run, 'collecting', async signal => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
    let found = [], actualUrl = request.url, client;
    try {
      client = createHttpClient({ http: run.http, safety: 'read' }, { signal: controller.signal,
        validateRequest: input => assertReadRequest(input, run.origin, run.allowedOrigins),
        observe: entry => {
          actualUrl = entry.url;
          if (!discovery) found = extractExplorationEvidence({ entries: [entry] }, run.origin, run.allowedOrigins).map(candidate => ({ ...candidate,
            observation: { mode: 'http', at: new Date().toISOString(), reason },
            sourceEvidence: { ...buildApiSourceEvidence(candidate, { sourceKind: 'host_http' }), risk: candidate.risk } }));
        } });
      const data = await client.request({ ...request, response: 'json' });
      if (signal.aborted) return;
      if (discovery) {
        const document = discoverOpenApi(data, actualUrl, run.http.origins);
        run.discoveries = [...(run.discoveries || []).filter(item => item.url !== document.url), { ...document, reason, observedAt: new Date().toISOString() }].slice(-10);
      } else run.candidates = [...new Map([...run.candidates, ...found].map(item => [item.id, item])).values()].slice(-100);
      service.update(run, 'evidence_ready', discovery ? 'API document inspected. Choose an endpoint and send an explicit read request before generating.' : 'Host HTTP response structure observed. Write an explicit HTTP plan and authored cases.');
    } catch (error) {
      if (signal.aborted) return;
      if (!discovery && found.length) run.candidates = [...new Map([...run.candidates, ...found].map(item => [item.id, item])).values()].slice(-100);
      throw timedOut ? fail('HTTP_TIMEOUT', 'HTTP observation timed out; no request was replayed.') : error;
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); client?.dispose();
    }
  });
}
