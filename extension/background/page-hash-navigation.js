import { executePageSource } from './page-source.js';
import { matchesPagePath } from './page-navigation.js';
import { navigationResultValue } from './page-navigation-parameters.js';

const fail = (code, message) => Object.assign(new Error(message), { code });
const scalar = value => typeof value === 'string' ? value.length > 0 : typeof value === 'number' && Number.isFinite(value);
const shape = (value, depth = 0) => {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value;
  if (depth >= 8) return { type };
  if (type === 'array') return { type, length: value.length, items: value.length ? shape(value[0], depth + 1) : { type: 'unknown' } };
  if (type === 'object') return { type, properties: Object.fromEntries(Object.entries(value).filter(([key]) => /^[a-zA-Z_$][a-zA-Z0-9_$-]{0,99}$/.test(key)).map(([key, child]) => [key, shape(child, depth + 1)])) };
  return { type };
};

// Deliberately separate from document navigation: a fragment event is not a
// document, a changed URL is not fresh business data, and an equal target needs
// one explicitly declared reload instead of a detour or a synthetic hash event.
export async function executePageHashNavigation({ chrome, ensureCdpAttached, tabId, payload, destination, now, sleep, assertRunning, captureWorkflowPage }) {
  const { source, expectedOrigin, expectedPath, values, metadataOnly } = payload;
  const hash = source.hashNavigation, deadline = now() + source.timeoutMs;
  const active = () => { assertRunning(); if (now() >= deadline) throw fail('PAGE_QUERY_TIMEOUT', 'Hash navigation timed out; no action was replayed.'); };
  const initial = new URL((await chrome.tabs.get(tabId)).url);
  if (!(initial.origin === expectedOrigin && matchesPagePath(initial.pathname, expectedPath)
    || initial.origin === destination.origin && matchesPagePath(initial.pathname, source.resultPathname))) throw fail('PAGE_QUERY_ROUTE_CHANGED', 'Open the declared hash entry or result page.');
  await ensureCdpAttached(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
  const frame = async () => (await chrome.debugger.sendCommand({ tabId }, 'Page.getFrameTree'))?.frameTree?.frame;
  const original = await frame();
  if (!original?.id || !original.loaderId) throw fail('PAGE_QUERY_ROUTE_CHANGED', 'Cannot establish the hash navigation document.');
  const read = () => executePageSource(chrome, tabId, { source: source.result, expectedOrigin: destination.origin, expectedPath: destination.pathname });
  const sameTarget = initial.href === destination.href;
  const sameBase = initial.origin + initial.pathname + initial.search === destination.origin + destination.pathname + destination.search;
  let before;
  if (sameBase) {
    try { const result = await read(); if (result?.ok) before = navigationResultValue(result.data, hash.freshnessPath); } catch { /* Missing baseline must not pass as freshness. */ }
    if (!scalar(before)) throw fail('PAGE_HASH_FRESHNESS_UNAVAILABLE', 'The declared business freshness field is unavailable before fragment navigation.');
  }
  let error, version = 0, documentCount = 0, withinCount = 0, loaderId = original.loaderId;
  const listener = (sender, method, params) => {
    if (sender.tabId !== tabId || sender.sessionId) return;
    if (method === 'Page.frameNavigated' && !params.frame?.parentId) {
      version++; documentCount++; loaderId = params.frame.loaderId;
      if (params.frame.id !== original.id || !loaderId || loaderId === original.loaderId || documentCount > 1) error = fail('PAGE_QUERY_ROUTE_CHANGED', 'Hash navigation document changed unexpectedly.');
      try { if (new URL(params.frame.url).origin !== destination.origin) error = fail('PAGE_QUERY_ORIGIN_CHANGED', 'Hash navigation left its declared origin.'); } catch { error = fail('PAGE_QUERY_ROUTE_CHANGED', 'Invalid hash navigation document.'); }
    } else if (method === 'Page.navigatedWithinDocument' && params.frameId === original.id) {
      version++; withinCount++;
      try { if (new URL(params.url).origin !== destination.origin) { error = fail('PAGE_QUERY_ORIGIN_CHANGED', 'Hash navigation left its declared origin.'); return; } } catch { error = fail('PAGE_QUERY_ROUTE_CHANGED', 'Invalid hash navigation URL.'); return; }
      if (params.url !== destination.href || withinCount > 1) error = fail('PAGE_QUERY_ROUTE_CHANGED', 'Hash navigation did not retain its exact target.');
    }
  };
  chrome.debugger.onEvent.addListener(listener);
  let timer;
  try {
    const prepared = await frame();
    if ((await chrome.tabs.get(tabId)).url !== initial.href || prepared?.id !== original.id || prepared?.loaderId !== original.loaderId || version) throw fail('PAGE_QUERY_ROUTE_CHANGED', 'Page changed before hash navigation.');
    active();
    const response = await Promise.race([
      chrome.debugger.sendCommand({ tabId }, sameTarget ? 'Page.reload' : 'Page.navigate', sameTarget ? { ignoreCache: true } : { url: destination.href }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(fail('PAGE_QUERY_TIMEOUT', 'Hash navigation did not respond; it was not replayed.')), deadline - now()); }),
    ]);
    clearTimeout(timer);
    if (response?.errorText || response?.isDownload) throw fail('PAGE_QUERY_NAVIGATION_FAILED', 'Hash navigation failed or started a download; it was not replayed.');
    let stable, stableSince, stableVersion;
    while (now() < deadline) {
      active(); if (error) throw error;
      const current = await chrome.tabs.get(tabId), url = new URL(current.url);
      const pendingTabSnapshot = url.href === initial.href && url.href !== destination.href;
      if (url.origin !== destination.origin && !pendingTabSnapshot) throw fail('PAGE_QUERY_ORIGIN_CHANGED', 'Hash navigation left its declared origin.');
      const newDocument = documentCount === 1;
      if ((newDocument || (!sameTarget && sameBase && withinCount === 1)) && current.status === 'complete' && !pendingTabSnapshot) {
        if (url.href !== destination.href) throw fail('PAGE_QUERY_ROUTE_CHANGED', 'Hash navigation changed the complete destination URL.');
        const observedVersion = version, currentFrame = await frame();
        if (currentFrame?.id !== original.id || currentFrame?.loaderId !== loaderId) throw fail('PAGE_QUERY_ROUTE_CHANGED', 'Hash navigation document identity changed.');
        let result; try { result = await read(); } catch { result = null; }
        const stamp = result?.ok ? navigationResultValue(result.data, hash.freshnessPath) : undefined;
        const correlated = result?.ok && Object.entries(hash.matchResult).every(([path, name]) => navigationResultValue(result.data, path) === values[name]);
        if (correlated && scalar(stamp) && (!sameBase || stamp !== before) && observedVersion === version) {
          const serialized = JSON.stringify(result.data);
          if (stable !== serialized || stableVersion !== version) { stable = serialized; stableVersion = version; stableSince = now(); }
          else if (now() - stableSince >= 300) {
            const finalFrame = await frame(), finalUrl = (await chrome.tabs.get(tabId)).url;
            active(); if (error) throw error;
            if (observedVersion !== version || finalUrl !== destination.href || finalFrame?.id !== original.id || finalFrame?.loaderId !== loaderId) throw fail('PAGE_QUERY_ROUTE_CHANGED', 'Hash result document changed during extraction.');
            const output = metadataOnly ? { ok: true, shape: shape(result.data) } : result;
            return captureWorkflowPage ? { ...output, internalWorkflowPage: { url: finalUrl, frameId: original.id, loaderId } } : output;
          }
        } else stable = undefined;
      } else stable = undefined;
      await sleep(100);
    }
    throw fail('PAGE_QUERY_TIMEOUT', 'No fresh, correlated, stable hash result appeared; no action was replayed.');
  } finally { clearTimeout(timer); chrome.debugger.onEvent.removeListener(listener); }
}
