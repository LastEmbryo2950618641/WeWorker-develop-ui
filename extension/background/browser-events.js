import { browserNetworkBody, browserNetworkUrl } from './browser-network.js';

const tabs = new Map(), LIMIT = 200, PENDING_LIMIT = 1000;
const fail = (code, message) => Object.assign(new Error(message), { code });
const cursor = (state, channel, sequence) => `${state.epoch}:${channel}:${sequence}`;
const sourceKey = source => source.sessionId || '';
export function beginBrowserEvents(tabId) {
  if (!tabs.has(tabId)) tabs.set(tabId, { epoch: crypto.randomUUID(), console: [], network: [], sequence: { console: 0, network: 0 }, pending: new Map(), parents: new Map() });
}
export function clearBrowserEvents(tabId) { tabs.delete(tabId); }
function push(state, channel, entry) {
  const sequence = ++state.sequence[channel];
  state[channel].push({ ...entry, sequence, eventCursor: cursor(state, channel, sequence),
    ...(channel === 'network' ? { key: `event:${state.epoch}:${sequence}` } : {}) });
  if (state[channel].length > LIMIT) state[channel].shift();
}
const safeUrl = value => typeof value === 'string' && value.length <= 8192 && /^https?:/.test(value) ? browserNetworkUrl(value) : '';

// Metadata-only ring, separate from exploration/body capture. Request IDs are
// scoped to their debugging session; child frames cannot overwrite root IDs.
export function recordBrowserEvent(tabId, source, method, params = {}) {
  const state = tabs.get(tabId); if (!state) return;
  const now = Date.now(), session = sourceKey(source);
  if (method === 'Target.attachedToTarget') { state.parents.set(params.sessionId, session); return; }
  if (method === 'Runtime.consoleAPICalled' || method === 'Runtime.exceptionThrown') {
    const text = method === 'Runtime.consoleAPICalled'
      ? (params.args || []).map(arg => typeof arg.value === 'object' ? '[object]' : String(arg.value ?? arg.description ?? arg.type)).join(' ')
      : String(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Page exception');
    push(state, 'console', { level: params.type || 'error', text: text.slice(0, 8000), timestamp: now, source: session ? 'child-frame' : 'main-target' });
    return;
  }
  const id = `${session}:${params.requestId}`;
  if (method === 'Network.requestWillBeSent') {
    // Even if a successor is later evicted from pending, its reused CDP ID
    // must never make an older retained event read that successor's body.
    for (const entry of state.network) if (entry.sourceSessionId === session && entry.requestId === params.requestId) entry.bodyAvailable = false;
    const previous = state.pending.get(id);
    if (previous && params.redirectResponse) push(state, 'network', { ...previous, timestamp: now,
      phase: 'redirect', status: params.redirectResponse.status, contentType: params.redirectResponse.mimeType || '', bodyAvailable: false });
    const request = params.request || {};
    state.pending.set(id, { requestId: params.requestId, sourceSessionId: session, startedAt: now,
      url: safeUrl(request.url), method: String(request.method || 'GET').slice(0, 20), resourceType: params.type || '',
      request: browserNetworkBody(String(request.postData || '').slice(0, 2000)) });
    if (state.pending.size > PENDING_LIMIT) {
      state.pending.delete(state.pending.keys().next().value);
      push(state, 'network', { timestamp: now, phase: 'gap', reason: 'pending_limit', dropped: 1 });
    }
  } else if (method === 'Network.responseReceived') {
    const entry = state.pending.get(id); if (entry) Object.assign(entry, { status: params.response?.status, contentType: String(params.response?.mimeType || '').slice(0, 200) });
  } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
    const entry = state.pending.get(id); if (!entry) return;
    push(state, 'network', { ...entry, timestamp: now, phase: method.endsWith('Failed') ? 'failed' : 'complete',
      bodyAvailable: method.endsWith('Finished'), size: Math.max(0, Number(params.encodedDataLength) || 0),
      ...(method.endsWith('Failed') ? { error: String(params.errorText || 'Network failed').slice(0, 500), canceled: !!params.canceled } : {}) });
    state.pending.delete(id);
  } else if (method === 'Target.detachedFromTarget') {
    const removed = new Set([params.sessionId]);
    for (let changed = true; changed;) { changed = false; for (const [child, parent] of state.parents) if (removed.has(parent) && !removed.has(child)) { removed.add(child); changed = true; } }
    for (const target of removed) state.parents.delete(target);
    for (const [key, entry] of state.pending) if (removed.has(entry.sourceSessionId)) {
      push(state, 'network', { ...entry, timestamp: now, phase: 'failed', bodyAvailable: false, error: 'Frame detached before completion.' });
      state.pending.delete(key);
    }
  }
}

export function browserDuration(value, name) {
  if (value === undefined) return undefined;
  const match = String(value).match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  const milliseconds = match ? Number(match[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2] || 's']) : NaN;
  if (!Number.isFinite(milliseconds) || milliseconds > 86400000) throw fail('INVALID_ARGUMENT', `${name} must be a duration from 0 to 24h (bare numbers are seconds).`);
  return milliseconds;
}
export function browserTimeWindow(args, now = Date.now()) {
  const since = browserDuration(args.since, 'since'), until = browserDuration(args.until, 'until');
  if (since !== undefined && until !== undefined && since < until) throw fail('INVALID_ARGUMENT', 'since must be at least as old as until.');
  return { lower: since === undefined ? -Infinity : now - since, upper: until === undefined ? Infinity : now - until };
}
export function readBrowserEvents(tabId, args) {
  const state = tabs.get(tabId), channel = args.channel;
  if (!['console', 'network'].includes(channel)) throw fail('INVALID_ARGUMENT', 'channel must be console or network.');
  if (!state) throw fail('OBSERVATION_CONTEXT_EXPIRED', 'Browser observation expired. Bind the intended tab and read a new event cursor.');
  const rows = state[channel], oldest = rows[0]?.sequence || 1;
  let after = oldest - 1;
  if (args.cursor !== undefined) {
    const prefix = `${state.epoch}:${channel}:`;
    if (typeof args.cursor !== 'string' || !args.cursor.startsWith(prefix) || !/^(0|[1-9][0-9]*)$/.test(args.cursor.slice(prefix.length))) throw fail('OBSERVATION_CURSOR_EXPIRED', 'Cursor belongs to a different tab, channel or observation.');
    after = Number(args.cursor.slice(prefix.length));
    if (!Number.isSafeInteger(after) || after > state.sequence[channel]) throw fail('INVALID_ARGUMENT', 'Event cursor is ahead of the observation.');
    if (after < oldest - 1) throw fail('OBSERVATION_CURSOR_EXPIRED', 'Events were evicted from the bounded buffer. Read a new snapshot explicitly; the missing interval cannot be replayed.');
  }
  const limit = args.limit === undefined ? 100 : (typeof args.limit === 'number' || (typeof args.limit === 'string' && /^\d+$/.test(args.limit))) ? Number(args.limit) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT) throw fail('INVALID_ARGUMENT', 'limit must be 1–200.');
  if (args.match !== undefined && (typeof args.match !== 'string' || args.match.length > 2000)) throw fail('INVALID_ARGUMENT', 'match must be a substring of at most 2000 characters.');
  const level = args.level === 'warn' ? 'warning' : args.level;
  for (const flag of ['all', 'failed']) if (args[flag] !== undefined && ![true, false, 'true', 'false'].includes(args[flag])) throw fail('INVALID_ARGUMENT', `${flag} must be true or false.`);
  if (level !== undefined && !['all', 'log', 'info', 'debug', 'warning', 'error', 'assert'].includes(level)) throw fail('INVALID_ARGUMENT', 'Unknown console level.');
  if (channel === 'console' && (args.all !== undefined || args.failed !== undefined)) throw fail('INVALID_ARGUMENT', 'all/failed apply only to network events.');
  if (channel === 'network' && level !== undefined) throw fail('INVALID_ARGUMENT', 'level applies only to console events.');
  const now = Date.now(), { lower, upper } = browserTimeWindow(args, now);
  const entries = [], startCursor = cursor(state, channel, after);
  let more = false, deferred = false;
  for (const entry of rows.filter(entry => entry.sequence > after)) {
    // --until is a rolling age bound. Do not consume younger events: they may
    // become eligible on the next poll. Sequence, not timestamp, deduplicates.
    if (entry.timestamp > upper) { deferred = true; break; }
    const matches = entry.phase === 'gap' || (entry.timestamp >= lower
      && (!args.match || (channel === 'network' ? entry.url : entry.text).includes(args.match))
      && (!level || level === 'all' || entry.level === level)
      && (!(args.failed === true || args.failed === 'true') || entry.phase === 'failed' || entry.status >= 400)
      && (channel !== 'network' || args.all === true || args.all === 'true' || ['Fetch', 'XHR'].includes(entry.resourceType) || /json/i.test(entry.contentType || '')));
    if (matches && entries.length === limit) { more = true; break; }
    after = entry.sequence;
    if (matches) {
      const { sourceSessionId, requestId, request, bodyAvailable, ...visible } = entry;
      entries.push({ ...visible, ...(channel === 'network' ? { source: sourceSessionId ? 'child-frame' : 'main-target' } : {}) });
    }
  }
  return { observationVersion: 1, channel, capturedAt: now, startCursor, nextCursor: cursor(state, channel, after),
    entries, hasMore: more, deferred, truncated: args.cursor === undefined && oldest > 1 };
}

export async function readNetworkEventDetail(chrome, tabId, key) {
  const state = tabs.get(tabId), entry = state?.network.find(entry => entry.key === key);
  if (!entry || entry.phase === 'gap') throw fail('NETWORK_ENTRY_EXPIRED', 'Network event is no longer captured. Read browser.events again.');
  const reused = () => !entry.bodyAvailable || tabs.get(tabId) !== state || !state.network.includes(entry) || state.network.some(item => item.sequence > entry.sequence && item.sourceSessionId === entry.sourceSessionId && item.requestId === entry.requestId)
    || state.pending.has(`${entry.sourceSessionId}:${entry.requestId}`);
  let response = { omitted: true, reason: 'The response body is unavailable for this event.' };
  if (entry.bodyAvailable && !reused()) try {
    const body = await chrome.debugger.sendCommand({ tabId, ...(entry.sourceSessionId ? { sessionId: entry.sourceSessionId } : {}) }, 'Network.getResponseBody', { requestId: entry.requestId });
    const text = body.base64Encoded ? new TextDecoder().decode(Uint8Array.from(atob(body.body), c => c.charCodeAt(0))) : String(body.body || '');
    if (!reused()) response = text.length > 500000 ? { omitted: true, reason: 'Body exceeds 500000 characters.' } : browserNetworkBody(text);
  } catch { /* Never retry against a different target or request. */ }
  return { entry: { key, url: entry.url, method: entry.method, status: entry.status, phase: entry.phase,
    contentType: entry.contentType, request: entry.request, response } };
}
