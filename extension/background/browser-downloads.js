import { browserNetworkUrl } from './browser-network.js';

const states = new Map();
const MAX_DOWNLOADS = 100;
const fail = (code, message, details) => Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
const cursor = (state, sequence = state.sequence) => `${state.epoch}:${sequence}`;
export function beginBrowserDownloads(tabId) {
  if (!states.has(tabId)) states.set(tabId, { epoch: crypto.randomUUID(), sequence: 0, action: 0, records: new Map() });
}
export function clearBrowserDownloads(tabId) { states.delete(tabId); }
export function markBrowserDownloadAction(tabId) {
  const state = states.get(tabId); if (state) state.action = state.sequence;
}
export function recordBrowserDownload(tabId, method, params) {
  const state = states.get(tabId); if (!state || typeof params.guid !== 'string') return;
  if (method === 'Page.downloadWillBegin') {
    if (state.records.has(params.guid)) return;
    const url = String(params.url || '');
    state.records.set(params.guid, { downloadId: params.guid, sequence: ++state.sequence, startedAt: Date.now(),
      url: url.length <= 8192 && /^(https?:|blob:)/.test(url) ? url : '', suggestedFilename: String(params.suggestedFilename || '').slice(0, 4096),
      state: 'in_progress', receivedBytes: 0, totalBytes: 0 });
    while (state.records.size > MAX_DOWNLOADS) state.records.delete(state.records.keys().next().value);
  } else if (method === 'Page.downloadProgress') {
    const record = state.records.get(params.guid); if (!record || record.state !== 'in_progress') return;
    if (Number.isFinite(params.receivedBytes)) record.receivedBytes = Math.max(0, params.receivedBytes);
    if (Number.isFinite(params.totalBytes)) record.totalBytes = Math.max(0, params.totalBytes);
    if (params.state === 'completed' || params.state === 'canceled') {
      record.state = params.state === 'completed' ? 'complete' : 'interrupted'; record.endedAt = Date.now();
    }
  }
}
const view = (record, state) => ({ downloadId: record.downloadId, cursor: cursor(state, record.sequence),
  url: browserNetworkUrl(record.url), urlOmitted: !record.url, suggestedFilename: record.suggestedFilename, state: record.state,
  startedAt: new Date(record.startedAt).toISOString(), ...(record.endedAt ? { endedAt: new Date(record.endedAt).toISOString() } : {}),
  receivedBytes: record.receivedBytes, totalBytes: record.totalBytes });

function select(tabId, args, wait = false) {
  const state = states.get(tabId);
  if (!state) throw fail('DOWNLOAD_CONTEXT_EXPIRED', 'Download observation expired. Bind the intended tab and record a new browser.downloads cursor.');
  if (args.downloadId !== undefined && (typeof args.downloadId !== 'string' || !args.downloadId || args.downloadId.length > 200)) throw fail('INVALID_ARGUMENT', 'downloadId must be returned by browser.downloads.');
  if (args.after !== undefined && args.downloadId !== undefined) throw fail('INVALID_ARGUMENT', 'Choose either after or downloadId.');
  let after = wait ? state.action : 0;
  if (args.after !== undefined) {
    if (typeof args.after !== 'string' || !args.after.startsWith(state.epoch + ':') || !/^(0|[1-9][0-9]*)$/.test(args.after.slice(state.epoch.length + 1))) throw fail('DOWNLOAD_CURSOR_EXPIRED', 'Cursor belongs to another browser observation. Read browser.downloads again.');
    after = Number(args.after.slice(state.epoch.length + 1));
    if (!Number.isSafeInteger(after) || after > state.sequence) throw fail('INVALID_ARGUMENT', 'Download cursor is ahead of this observation.');
  }
  const oldest = state.records.values().next().value?.sequence || 1;
  if (!args.downloadId && (wait || args.after !== undefined) && after < oldest - 1) throw fail('DOWNLOAD_CURSOR_EXPIRED', 'Older downloads were evicted. Read browser.downloads and select a current downloadId.');
  let records = [...state.records.values()].filter(record => args.downloadId ? record.downloadId === args.downloadId : record.sequence > after);
  if (args.downloadId && !records.length) throw fail('DOWNLOAD_NOT_FOUND', 'This download is not in the selected tab observation.');
  const pattern = args.value ?? args.match ?? '';
  if (typeof pattern !== 'string' || pattern.length > 2000) throw fail('INVALID_ARGUMENT', 'Download match must be a filename or URL substring of at most 2000 characters.');
  if (pattern) records = records.filter(record => record.suggestedFilename.includes(pattern) || browserNetworkUrl(record.url).includes(pattern));
  return { state, records };
}

export function readBrowserDownloads(tabId, args) {
  const { state, records } = select(tabId, args);
  const limit = args.limit === undefined ? 50 : Number(args.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DOWNLOADS) throw fail('INVALID_ARGUMENT', 'limit must be 1–100.');
  const batch = records.slice(0, limit);
  return { source: 'tab-download-events', cursor: cursor(state), downloads: batch.map(record => view(record, state)),
    truncated: records.length > limit, nextCursor: batch.length ? cursor(state, batch.at(-1).sequence) : cursor(state) };
}

// Page events prove tab attribution, but their GUID is not a chrome.downloads
// numeric ID. Enrich from a unique URL/time match only; never guess a file path.
async function downloadFile(chrome, record) {
  if (!chrome.downloads?.search || !record.url) return { fileResolved: false, fileResolution: 'unavailable' };
  try {
    const literal = `^${record.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
    const range = { startedAfter: new Date(record.startedAt - 2000).toISOString(), startedBefore: new Date(record.startedAt + 2000).toISOString(), limit: 100 };
    const groups = await Promise.all([chrome.downloads.search({ ...range, urlRegex: literal }), chrome.downloads.search({ ...range, finalUrlRegex: literal })]);
    const matches = [...new Map(groups.flat().map(item => [item.id, item])).values()];
    if (matches.length !== 1) return { fileResolved: false, fileResolution: matches.length ? 'ambiguous' : 'not_found' };
    const item = matches[0];
    return { fileResolved: Boolean(item.filename), fileResolution: 'unique_url_time_match', chromeDownloadId: item.id,
      ...(item.filename ? { filename: item.filename } : {}), ...(item.mime ? { mime: item.mime } : {}),
      ...(item.finalUrl ? { finalUrl: browserNetworkUrl(item.finalUrl) } : {}), danger: item.danger, error: item.error, exists: item.exists };
  } catch { return { fileResolved: false, fileResolution: 'unavailable' }; }
}

export async function waitBrowserDownload(chrome, tabId, args) {
  if (args.frameId !== undefined || args.documentId !== undefined) throw fail('INVALID_ARGUMENT', 'Download observation belongs to the tab; select a downloadId or cursor instead of a frame.');
  const timeout = args.timeoutMs === undefined ? 30000 : Number(args.timeoutMs);
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > 30000) throw fail('INVALID_ARGUMENT', 'Download timeoutMs must be 0–30000. Repeat a wait with the same downloadId for longer transfers.');
  const initial = select(tabId, args, true), state = initial.state, started = Date.now();
  // Freeze the action boundary: a click in another CLI process must not move a
  // pending observer past the very download it was waiting for.
  const selectedArgs = args.downloadId || args.after !== undefined ? args : { ...args, after: cursor(state, state.action) };
  let record;
  do {
    if (states.get(tabId) !== state) throw fail('DOWNLOAD_CONTEXT_EXPIRED', 'The tab or browser observation closed while waiting.');
    const matches = select(tabId, selectedArgs, true).records;
    if (matches.length > 1) throw fail('DOWNLOAD_AMBIGUOUS', 'More than one download matches. Read browser.downloads and select a downloadId.', { matches: matches.map(item => view(item, state)) });
    record = matches[0];
    if (record && record.state !== 'in_progress') {
      const download = { ...view(record, state), ...await downloadFile(chrome, record) };
      if (record.state === 'interrupted') throw fail('DOWNLOAD_INTERRUPTED', 'Chrome interrupted or canceled the download. Inspect its state before deciding whether to retry.', { download, elapsedMs: Date.now() - started });
      return { downloaded: true, ...download, elapsedMs: Date.now() - started };
    }
    if (Date.now() - started >= timeout) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(100, timeout - (Date.now() - started))));
  } while (true);
  throw fail('DOWNLOAD_TIMEOUT', record ? 'Download started but has not completed. Wait again with its downloadId; do not repeat the click.' : 'No matching new download was observed.',
    { downloaded: false, state: record ? 'in_progress' : 'not_seen', ...(record ? { download: view(record, state) } : {}), elapsedMs: Date.now() - started });
}
