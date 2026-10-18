import { executePageHashNavigation } from './page-hash-navigation.js';
import { executePageSource } from './page-source.js';
import { pageWorkflowContract } from './page-workflow.js';
import { normalizeNavigationQueryParameters, appendNavigationQuery, normalizeHashNavigation, appendNavigationHash } from './page-navigation-parameters.js';

const fail = (code, message) => Object.assign(new Error(message), { code });
const validValue = value => typeof value === 'string' && value.trim() && value.length <= 512
  && !['.', '..', ':id', '<value>'].includes(value) && !/[/\\%\u0000-\u001f\u007f]/.test(value);

export function matchesPagePath(pathname, template) {
  if (typeof template !== 'string') return false;
  const actual = pathname.split('/'), expected = template.split('/');
  return actual.length === expected.length && expected.every((part, index) => {
    if (part !== ':id') return part === actual[index];
    try { return !!validValue(decodeURIComponent(actual[index])); } catch { return false; }
  });
}

export function resolvePageDestination(origin, source, values = {}, allowStatic = false) {
  const url = new URL(origin + source.resultPathname);
  if (url.origin !== origin || url.pathname !== source.resultPathname || url.search || url.hash || url.username || url.password
    || !['http:', 'https:'].includes(url.protocol)) throw fail('INVALID_PAGE_QUERY', 'Invalid navigation route.');
  const bindings = source.pathParameters, segments = url.pathname.slice(1).split('/');
  let queries, hash;
  try { queries = normalizeNavigationQueryParameters(source.queryParameters, bindings); hash = normalizeHashNavigation(source.hashNavigation, [...bindings, ...queries]); }
  catch { throw fail('INVALID_PAGE_QUERY_ARGUMENT', 'Invalid public page query bindings.'); }
  if (!Array.isArray(bindings) || (!bindings.length && !queries.length && !hash && !allowStatic) || bindings.length > 16 || !values || typeof values !== 'object' || Array.isArray(values)) throw fail('INVALID_PAGE_QUERY_ARGUMENT', 'Provide explicit page path bindings and values.');
  const names = new Set(), indexes = new Set();
  for (const { segmentIndex, name } of bindings) {
    if (!Number.isSafeInteger(segmentIndex) || segments[segmentIndex] !== ':id' || indexes.has(segmentIndex)
      || typeof name !== 'string' || names.has(name) || !Object.hasOwn(values, name) || !validValue(values[name])) throw fail('INVALID_PAGE_QUERY_ARGUMENT', 'Each page identifier must bind one declared path segment.');
    names.add(name); indexes.add(segmentIndex);
    try { segments[segmentIndex] = encodeURIComponent(values[name]); } catch { throw fail('INVALID_PAGE_QUERY_ARGUMENT', 'Page identifiers must be valid Unicode.'); }
  }
  for (const binding of [...queries, ...(hash?.pathParameters || []), ...(hash?.queryParameters || [])]) names.add(binding.name);
  if (segments.includes(':id') || Object.keys(values).some(name => !names.has(name))) throw fail('INVALID_PAGE_QUERY_ARGUMENT', 'Provide only the complete declared page identifiers.');
  url.pathname = '/' + segments.join('/');
  try { appendNavigationQuery(url, queries, values); appendNavigationHash(url, hash, values); }
  catch { throw fail('INVALID_PAGE_QUERY_ARGUMENT', 'Provide valid public query strings.'); }
  if (/approve|reject|delete|remove|update|edit|submit|create|add|cancel|publish|confirm|apply|save|write|mutation|session|logout|mark.?read|审批|批准|驳回|删除|修改|提交|创建|新增|取消|发布|确认|更新/i.test(decodeURIComponent(url.pathname))) throw fail('INVALID_PAGE_QUERY_ARGUMENT', 'Page navigation must target a read-only detail route.');
  return url;
}

/** Validate both ordinary and preview continuations against their manifest. */
export function assertPageQueryRoute(payload, command) {
  const route = command?.pageRoute;
  if (command?.pageWorkflow !== true || command.safety !== 'read' || payload?.version !== 1
    || payload.expectedOrigin !== route?.origin || payload.expectedPath !== route.pathname) throw fail('INVALID_PAGE_QUERY', 'Page query route differs from the selected command.');
  if (payload.source?.mode === 'workflow') {
    if (!route.workflow || JSON.stringify(pageWorkflowContract(payload.source)) !== JSON.stringify(route.workflow)) throw fail('INVALID_PAGE_QUERY', 'Workflow actions differ from the declared steps.');
    return route.origin + route.pathname;
  }
  if (route.workflow) throw fail('INVALID_PAGE_QUERY', 'A workflow must execute its complete declared sequence.');
  if (payload.source?.mode === 'navigate') {
    if (!route.navigation || payload.source.resultPathname !== route.navigation.pathname
      || JSON.stringify(payload.source.pathParameters) !== JSON.stringify(route.navigation.pathParameters)
      || JSON.stringify(payload.source.queryParameters) !== JSON.stringify(route.navigation.queryParameters)
      || JSON.stringify(payload.source.hashNavigation) !== JSON.stringify(route.navigation.hashNavigation)) throw fail('INVALID_PAGE_QUERY', 'Navigation differs from the declared path/query bindings.');
    return resolvePageDestination(route.origin, payload.source, payload.values).href;
  }
  if (route.navigation || ![route.pathname, ...(route.additionalPaths || [])].includes(payload.source?.resultPathname)) throw fail('INVALID_PAGE_QUERY', 'Query destination differs from the selected command.');
  return route.origin + payload.source.resultPathname;
}

/** One explicit navigation, retained in the background across document replacement. */
export async function executePageNavigation({ chrome, ensureCdpAttached, tabId, payload, now, sleep, allowStaticNavigation = false, assertRunning = () => {}, captureWorkflowPage = false }) {
  const { source, expectedOrigin, expectedPath, values, metadataOnly = false } = payload;
  const destination = resolvePageDestination(expectedOrigin, source, values, allowStaticNavigation);
  if (source.hashNavigation) return executePageHashNavigation({ chrome, ensureCdpAttached, tabId, payload, destination, now, sleep, assertRunning, captureWorkflowPage });
  const initial = await chrome.tabs.get(tabId), initialUrl = new URL(initial.url);
  if (initialUrl.origin !== expectedOrigin || (!matchesPagePath(initialUrl.pathname, expectedPath) && !matchesPagePath(initialUrl.pathname, source.resultPathname))) throw fail('PAGE_QUERY_ROUTE_CHANGED', 'Open the observed entry or a declared detail page.');
  await ensureCdpAttached(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
  const initialFrame = (await chrome.debugger.sendCommand({ tabId }, 'Page.getFrameTree'))?.frameTree?.frame;
  if (!initialFrame?.id || !initialFrame.loaderId) throw fail('PAGE_QUERY_ROUTE_CHANGED', 'Cannot establish the initial page document.');
  let navigated = false, version = 0, error;
  let currentLoaderId = initialFrame.loaderId;
  const listener = (sender, method, params) => {
    if (sender.tabId !== tabId || sender.sessionId) return;
    if (method === 'Page.frameNavigated' && !params.frame?.parentId && params.frame?.id === initialFrame.id && params.frame.loaderId !== initialFrame.loaderId) {
      navigated = true; version++;
      currentLoaderId = params.frame.loaderId;
      try { if (new URL(params.frame.url).origin !== expectedOrigin) error = fail('PAGE_QUERY_ORIGIN_CHANGED', 'Navigation left the declared origin.'); }
      catch { error = fail('PAGE_QUERY_ORIGIN_CHANGED', 'Navigation left the declared origin.'); }
    } else if (method === 'Page.navigatedWithinDocument' && params.frameId === initialFrame.id) {
      version++;
      try { if (new URL(params.url).origin !== expectedOrigin) error = fail('PAGE_QUERY_ORIGIN_CHANGED', 'Navigation left the declared origin.'); }
      catch { error = fail('PAGE_QUERY_ORIGIN_CHANGED', 'Navigation left the declared origin.'); }
    }
  };
  chrome.debugger.onEvent.addListener(listener);
  let navigationTimer;
  try {
    const started = now();
    assertRunning();
    const response = await Promise.race([
      chrome.debugger.sendCommand({ tabId }, 'Page.navigate', { url: destination.href }),
      new Promise((_, reject) => { navigationTimer = setTimeout(() => reject(fail('PAGE_QUERY_TIMEOUT', 'Navigation did not respond before timeout; it may still finish and was not replayed.')), source.timeoutMs); }),
    ]);
    clearTimeout(navigationTimer);
    if (response?.errorText || response?.isDownload) throw fail('PAGE_QUERY_NAVIGATION_FAILED', 'Page navigation failed or initiated a download; it was not replayed.');
    let stable, stableVersion, stableSince = now();
    while (now() - started < source.timeoutMs) {
      assertRunning();
      if (error) throw error;
      const current = await chrome.tabs.get(tabId), url = new URL(current.url);
      if (url.origin !== expectedOrigin) throw fail('PAGE_QUERY_ORIGIN_CHANGED', 'Navigation left the declared origin.');
      if (navigated && current.status === 'complete') {
        if (url.href !== destination.href) throw fail('PAGE_QUERY_ROUTE_CHANGED', 'Navigation did not reach the requested page identifier.');
        const observedVersion = version;
        const readPayload = { source: source.result, expectedOrigin, expectedPath: destination.pathname };
        let result;
        try { result = await executePageSource(chrome, tabId, readPayload); } catch { result = null; }
        if (result?.ok && observedVersion === version) {
          const serialized = JSON.stringify(result.data);
          if (serialized !== stable || observedVersion !== stableVersion) { stable = serialized; stableVersion = observedVersion; stableSince = now(); }
          else if (now() - stableSince >= 300) {
            if (metadataOnly) result = await executePageSource(chrome, tabId, { ...readPayload, metadataOnly: true });
            assertRunning();
            const final = new URL((await chrome.tabs.get(tabId)).url);
            if (error) throw error;
            if (final.href !== destination.href || observedVersion !== version) throw fail('PAGE_QUERY_ROUTE_CHANGED', 'Page changed while reading navigation results.');
            if (captureWorkflowPage) {
              const frame = (await chrome.debugger.sendCommand({ tabId }, 'Page.getFrameTree'))?.frameTree?.frame;
              if (frame?.id !== initialFrame.id || frame?.loaderId !== currentLoaderId || observedVersion !== version) throw fail('PAGE_QUERY_ROUTE_CHANGED', 'Workflow navigation document changed before completion.');
            }
            return captureWorkflowPage ? { ...result, internalWorkflowPage: { url: final.href, frameId: initialFrame.id, loaderId: currentLoaderId } } : result;
          }
        } else stable = undefined;
      } else stable = undefined;
      await sleep(100);
    }
    throw fail('PAGE_QUERY_TIMEOUT', 'The requested page did not expose stable data before timeout. Navigation was not replayed.');
  } finally { clearTimeout(navigationTimer); chrome.debugger.onEvent.removeListener(listener); }
}
