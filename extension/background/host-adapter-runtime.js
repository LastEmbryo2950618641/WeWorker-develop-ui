/** Serialize page replacement and calls so an update cannot replace a running command's globals. */
export function createHostAdapterRuntime({ bundle, prepare, clear, inject, navigate, ready, now = Date.now, maxNavigations = 4, timeoutMs = 105000 }) {
  const queues = new Map();
  const stamps = new Map();
  const documents = new Map();
  return {
    invalidate(tabId) {
      stamps.delete(tabId);
      documents.set(tabId, (documents.get(tabId) || 0) + 1);
    },
    execute(tabId, manifest, url, operation = null, command = null, traceID = null) {
      const deadline = now() + timeoutMs;
      const task = (queues.get(tabId) || Promise.resolve()).catch(() => {}).then(async () => {
        const policy = command && manifest.commands?.find(entry => entry.id === command.id);
        let currentUrl = url;
        for (let step = 0; ; step++) {
          if (now() >= deadline) throw new Error('Adapter page execution timed out.');
          for (let attempt = 0; ; attempt++) {
            if (ready) currentUrl = await ready(tabId, manifest, Math.min(25000, deadline - now()), traceID);
            if (now() >= deadline) throw new Error('Adapter page execution timed out.');
            const stamp = JSON.stringify([manifest.name, manifest._hostSnapshot, currentUrl]);
            const sources = await bundle(manifest);
            if (stamps.get(tabId) === stamp) break;
            const document = documents.get(tabId) || 0;
            try {
              await prepare(tabId);
              await clear(tabId, manifest.name);
              stamps.delete(tabId);
              await inject(tabId, manifest, currentUrl, sources);
              if ((documents.get(tabId) || 0) !== document) throw new Error('Adapter document changed during injection.');
              stamps.set(tabId, stamp);
              break;
            } catch (error) {
              stamps.delete(tabId);
              // Registration has not invoked the business handler yet. Only
              // recover document changes; never replay an operation exception.
              const changed = (documents.get(tabId) || 0) !== document || /Adapter (document|target) changed/.test(error.message);
              if (!ready || !changed || attempt >= 2) throw error;
            }
          }
          if (now() >= deadline) throw new Error('Adapter page execution timed out.');
          const result = operation ? await operation(Math.max(1, deadline - now())) : undefined;
          const next = result?.__webcli_navigation;
          if (!next) return result;
          if (!policy || !navigate || next.version !== 1 || typeof next.resume !== 'boolean') throw new Error('Invalid Adapter navigation continuation.');
          // Never replay writes, regardless of confirmation policy. A write may
          // request terminal navigation only; errors and timeouts are never replayed.
          if (next.resume && policy.safety !== 'read') throw new Error('Write commands cannot be replayed after navigation.');
          if (step >= maxNavigations) throw new Error('Adapter navigation limit exceeded.');
          const target = assertAdapterNavigationUrl(manifest, next.url, next.resume);
          if (now() >= deadline) throw new Error('Adapter page execution timed out.');
          stamps.delete(tabId);
          currentUrl = await navigate(tabId, target, manifest, next.resume, Math.min(25000, deadline - now()));
          assertAdapterNavigationUrl(manifest, currentUrl, next.resume);
          if (now() >= deadline) throw new Error('Adapter page execution timed out.');
          if (!next.resume) return next.result ?? { status: 'navigation_complete', url: currentUrl };
        }
      });
      queues.set(tabId, task);
      void task.finally(() => { if (queues.get(tabId) === task) queues.delete(tabId); }).catch(() => {});
      return task;
    },
  };
}

/**
 * Classifies a navigation target against the package's declared hosts.
 * This is the single source of truth for the allowed-host rule; both the
 * strict assertion below and the fail-fast wait guard reuse it.
 *
 * - `allowed`: host is declared by `manifest.match` (always) or by
 *   `runtime_allowed_hosts` (terminal navigation only, i.e. `resume === false`).
 * - `forbidden`: a real http(s) page whose host is not declared.
 * - `unknown`: not judgeable yet (about:blank, chrome-error, data:, an
 *   unparseable value): the tab has not reached a page we can judge.
 */
export function classifyNavigationTarget(manifest, value, resume = true) {
  let url;
  try { url = new URL(String(value ?? '')); } catch { return 'unknown'; }
  if (!['http:', 'https:'].includes(url.protocol)) return 'unknown';
  if (url.username || url.password) return 'forbidden';
  const hosts = [...(manifest.match || []), ...(resume ? [] : (manifest.runtime_allowed_hosts || []))];
  const allowed = hosts.some(host => url.hostname === host || (host.startsWith('*.') && url.hostname.endsWith(host.slice(1))));
  return allowed ? 'allowed' : 'forbidden';
}

/** Navigation is limited to declared page hosts; helper hosts allow terminal navigation only. */
export function assertAdapterNavigationUrl(manifest, value, resume = true) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid Adapter navigation URL.'); }
  if (classifyNavigationTarget(manifest, url.href, resume) !== 'allowed') {
    throw new Error('Adapter navigation host is not allowed.');
  }
  return url.href;
}

/**
 * How long a URL must stay unchanged on a non-declared host before the wait is
 * abandoned. A 302/redirect chain (the normal "hop to A, then land on the
 * declared host" flow) changes `tab.url` within this window, which resets the
 * timer, so a still-redirecting tab is never rejected. Only a URL that has
 * stopped moving on a host the manifest does not declare is judged final.
 */
export const NAVIGATION_TARGET_SETTLE_MS = 1500;

/**
 * Tracks the URL observed while a page loads and decides when waiting can no
 * longer succeed. State lives in the returned closure; the decision itself is a
 * pure function of (manifest, observed URL, time).
 *
 * `observe(url, at)` returns `'reject'` only when the same non-declared http(s)
 * URL has been observed for `settleMs`; every other observation returns `'wait'`.
 * Non-http targets and declared hosts always return `'wait'` (they only affect
 * how long we wait, never correctness).
 */
export function createNavigationGuard(manifest, resume = true, options = {}) {
  const settleMs = Number.isFinite(options.settleMs) ? options.settleMs : NAVIGATION_TARGET_SETTLE_MS;
  const now = options.now || Date.now;
  let lastUrl = null;
  let stableSince = 0;
  return {
    observe(value, at = now()) {
      const url = String(value ?? '');
      if (classifyNavigationTarget(manifest, url, resume) !== 'forbidden') {
        lastUrl = null;
        stableSince = 0;
        return 'wait';
      }
      if (url !== lastUrl) {
        lastUrl = url;
        stableSince = at;
        return 'wait';
      }
      return at - stableSince >= settleMs ? 'reject' : 'wait';
    },
    get url() { return lastUrl; },
  };
}

/** Observe load events before initiating navigation, including same-URL reloads. */
export async function navigateAdapterTab(api, tabId, url, manifest, resume, timeoutMs) {
  assertAdapterNavigationUrl(manifest, url, resume);
  // Same fail-fast rule as waitForManagedPageReady: a redirect that settles on a
  // host the package does not declare is rejected without waiting for `complete`.
  const guard = createNavigationGuard(manifest, resume);
  let complete = false;
  const listener = (id, change) => { if (id === tabId && change.status === 'complete') complete = true; };
  api.tabs.onUpdated.addListener(listener);
  const deadline = Date.now() + timeoutMs;
  try {
    const current = await api.tabs.get(tabId);
    const reload = current.url === url;
    if (reload) await api.tabs.reload(tabId);
    else await api.tabs.update(tabId, { url });
    while (Date.now() < deadline) {
      const tab = await api.tabs.get(tabId);
      if (!tab) throw new Error('Adapter tab was closed.');
      if (tab.status === 'complete' && (complete || (!reload && tab.url === url))) {
        return assertAdapterNavigationUrl(manifest, tab.url, resume);
      }
      if (guard.observe(tab.url, Date.now()) === 'reject') {
        return assertAdapterNavigationUrl(manifest, tab.url, resume);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Adapter page navigation timed out.');
  } finally { api.tabs.onUpdated.removeListener(listener); }
}
