import { prepareInterceptAction } from './intercept-read.js';
import { executePageSource } from './page-source.js';
const busy = new Set();
const fail = (code, message) => Object.assign(new Error(message), { code });

/** Runs outside the page so a read query can survive document replacement. */
export async function executePageQuery({ chrome, ensureCdpAttached, tabId, payload, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (busy.has(tabId)) return { ok: false, error: { code: 'PAGE_QUERY_BUSY', message: 'A page query is already running.' } };
  busy.add(tabId);
  let listener;
  try {
    const { source, expectedOrigin, expectedPath, values = {}, metadataOnly = false } = payload;
    if (source?.mode !== 'query' || source.strategy !== 'UI_SELECTOR' || !source.result) throw fail('INVALID_PAGE_QUERY', 'Expected a declared UI query source.');
    const timeoutMs = source.timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw fail('INVALID_PAGE_QUERY', 'Invalid page query timeout.');
    const destination = new URL(expectedOrigin + source.resultPathname);
    if (destination.origin !== expectedOrigin || destination.pathname !== source.resultPathname || destination.search || destination.hash) throw fail('INVALID_PAGE_QUERY', 'Invalid result route.');
    const initial = await chrome.tabs.get(tabId), initialUrl = new URL(initial.url);
    if (initialUrl.origin !== expectedOrigin || ![expectedPath, source.resultPathname].includes(initialUrl.pathname)) throw fail('PAGE_QUERY_ROUTE_CHANGED', 'Open the observed query page.');
    const name = source.trigger?.parameter;
    if (Object.keys(values).some(key => key !== name) || (name && (typeof values[name] !== 'string' || !values[name].trim() || values[name].length > 1000))) throw fail('INVALID_PAGE_QUERY_ARGUMENT', 'Provide the declared query parameter.');
    const readPayload = { source: source.result, expectedOrigin, expectedPath: source.resultPathname, metadataOnly: false };
    let before;
    try { const observed = await executePageSource(chrome, tabId, readPayload); if (observed.ok) before = JSON.stringify(observed.data); } catch { /* The initial route may differ. */ }
    await ensureCdpAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, 'Page.bringToFront');
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
    const initialFrame = (await chrome.debugger.sendCommand({ tabId }, 'Page.getFrameTree'))?.frameTree?.frame;
    let documentChanged = false, navigated = false, navigationError, navigationVersion = 0;
    listener = (sender, method, params) => {
      if (sender.tabId !== tabId) return;
      if (method === 'Page.frameNavigated' && !params.frame?.parentId && (!initialFrame?.loaderId || params.frame.loaderId !== initialFrame.loaderId)) {
        documentChanged = true; navigated = true; navigationVersion++;
        try { if (new URL(params.frame.url).origin !== expectedOrigin) navigationError = fail('PAGE_QUERY_ORIGIN_CHANGED', 'Query navigation left the observed origin.'); } catch { navigationError = fail('PAGE_QUERY_ORIGIN_CHANGED', 'Query navigation left the observed origin.'); }
      } else if (method === 'Page.navigatedWithinDocument' && params.frameId === initialFrame?.id && params.url !== initial.url) { navigated = true; navigationVersion++; }
    };
    chrome.debugger.onEvent.addListener(listener);
    const started = now();
    let action;
    try {
      [{ result: action } = {}] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: prepareInterceptAction,
        args: [{ source, expectedOrigin, expectedPath: initialUrl.pathname, values }] });
    } catch (error) {
      // A select/input handler can navigate during executeScript. Never rerun
      // the action; only tolerate a destroyed context after observed navigation.
      if (!/frame.*removed|context.*destroyed|document.*unloaded/i.test(error.message || '')) throw error;
      if (!navigated) await sleep(100);
      if (!navigated) throw error;
    }
    if (!navigated && !action?.ok) throw fail(action?.error?.code || 'PAGE_QUERY_TARGET_CHANGED', action?.error?.message || 'The query control is unavailable.');
    if (!navigated && action?.point) for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type, ...action.point,
      ...(type !== 'mouseMoved' ? { button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 } : {}) });
    if (!navigated && action?.pressEnter) for (const type of ['keyDown', 'keyUp']) await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type, key: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
    let stableValue, stableSince = now(), lastError;
    while (now() - started < timeoutMs) {
      if (navigationError) throw navigationError;
      const current = await chrome.tabs.get(tabId), url = new URL(current.url);
      if (url.origin !== expectedOrigin) throw fail('PAGE_QUERY_ORIGIN_CHANGED', 'Query navigation left the observed origin.');
      const matches = url.pathname === source.resultPathname && Object.entries(source.matchQuery || {}).every(([field, parameter]) => url.searchParams.get(field) === values[parameter]);
      if (navigated && matches && current.status === 'complete') {
        let result; const version = navigationVersion;
        try { result = await executePageSource(chrome, tabId, readPayload); } catch { result = null; }
        if (result?.ok && version === navigationVersion) {
          const serialized = JSON.stringify(result.data);
          // SPA URL updates can precede result rendering. Never accept its old
          // rows as fresh evidence; equal results need a document navigation.
          if (documentChanged || serialized !== before) {
            if (serialized !== stableValue) { stableValue = serialized; stableSince = now(); }
            else if (now() - stableSince >= 300) {
              if (metadataOnly) result = await executePageSource(chrome, tabId, { ...readPayload, metadataOnly: true });
              if (version !== navigationVersion || navigationError) { stableValue = undefined; continue; }
              return result;
            }
          }
        } else { lastError = result?.error; stableValue = undefined; }
      } else stableValue = undefined;
      await sleep(100);
    }
    throw fail('PAGE_QUERY_TIMEOUT', lastError ? 'The result page did not expose the declared data before timeout.' : 'No fresh, stable page result matched the query before timeout.');
  } catch (error) { return { ok: false, error: { code: error.code || 'PAGE_QUERY_FAILED', message: error.code ? error.message : 'Unable to complete the page query.' } }; }
  finally { if (listener) chrome.debugger.onEvent.removeListener(listener); busy.delete(tabId); }
}
