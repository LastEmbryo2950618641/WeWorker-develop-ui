/**
 * Execute host-validated Adapter sources in this extension's isolated world.
 * Uses the existing debugger permission, never string eval in a scripting func.
 * A borrowed session is never detached; an unknown debugger is never adopted.
 */
const pendingTabs = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function injectAdapterSources(options) {
  const { tabId } = options;
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Invalid Adapter target tab.');
  const previous = pendingTabs.get(tabId) || Promise.resolve();
  const task = previous.catch(() => {}).then(() => injectSources(options));
  pendingTabs.set(tabId, task);
  try { return await task; }
  finally { if (pendingTabs.get(tabId) === task) pendingTabs.delete(tabId); }
}

async function injectSources({
  tabId, scripts, expectedUrl, api = globalThis.chrome,
  borrowedSession = false, existingContexts = () => [], timeoutMs = 2000,
}) {
  if (!Array.isArray(scripts) || !scripts.length || scripts.length > 512
    || scripts.some((script) => !script || typeof script.source !== 'string'
      || typeof script.path !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(script.path)
      || script.path.split('/').some((part) => !part || part === '.' || part === '..'))
    || scripts.reduce((size, script) => size + script.source.length, 0) > 8 * 1024 * 1024) {
    throw new Error('Invalid Adapter script bundle.');
  }
  const initialTab = await api.tabs.get(tabId);
  const targetUrl = expectedUrl || initialTab.url;
  if (!/^https?:\/\//.test(targetUrl || '') || initialTab.url !== targetUrl) {
    throw new Error('Adapter target changed or is unsupported.');
  }

  const target = { tabId };
  const contexts = new Map();
  const marker = '__weworkerAdapterContext_' + crypto.randomUUID().replaceAll('-', '');
  let owned = false;
  let marked = false;
  const onEvent = (source, method, params) => {
    if (source.tabId !== tabId || source.sessionId) return;
    if (method === 'Runtime.executionContextCreated') contexts.set(params.context.id, params.context);
    if (method === 'Runtime.executionContextDestroyed') contexts.delete(params.executionContextId);
    if (method === 'Runtime.executionContextsCleared') contexts.clear();
  };
  api.debugger.onEvent.addListener(onEvent);
  try {
    if (!borrowedSession) {
      await api.debugger.attach(target, '1.3');
      owned = true;
    }
    await api.debugger.sendCommand(target, 'Runtime.enable');
    const marks = await api.scripting.executeScript({
      target, world: 'ISOLATED',
      func: (key) => { globalThis[key] = true; },
      args: [marker],
    });
    marked = true;
    const documentId = marks?.find((entry) => entry.frameId === 0)?.documentId;
    let contextId;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && contextId === undefined) {
      for (const context of [...existingContexts(), ...contexts.values()]) {
        try {
          const result = await api.debugger.sendCommand(target, 'Runtime.evaluate', {
            expression: 'globalThis[' + JSON.stringify(marker) + '] === true',
            contextId: context.id, returnByValue: true, silent: true,
            allowUnsafeEvalBlockedByCSP: false,
          });
          if (result?.result?.value === true) { contextId = context.id; break; }
        } catch { /* A context may disappear during navigation. */ }
      }
      if (contextId === undefined) await sleep(25);
    }
    if (contextId === undefined) throw new Error('Adapter isolated world unavailable.');
    for (const script of scripts) {
      const tab = await api.tabs.get(tabId);
      if (tab.url !== targetUrl) throw new Error('Adapter target changed during loading.');
      const result = await api.debugger.sendCommand(target, 'Runtime.evaluate', {
        expression: 'if (globalThis[' + JSON.stringify(marker) + '] !== true) throw new Error("Adapter document changed");\n'
          + script.source + '\n//# sourceURL=weworker-adapter://' + script.path,
        contextId, returnByValue: true, awaitPromise: true,
        allowUnsafeEvalBlockedByCSP: false,
      });
      if (result?.exceptionDetails) {
        // Do not expose source text or captured values from a script exception.
        throw new Error('Adapter script failed: ' + script.path);
      }
    }
    return { tabId, documentId, scriptCount: scripts.length };
  } finally {
    if (marked) {
      await api.scripting.executeScript({
        target, world: 'ISOLATED',
        func: (key) => { delete globalThis[key]; },
        args: [marker],
      }).catch(() => {});
    }
    api.debugger.onEvent.removeListener(onEvent);
    if (owned) await api.debugger.detach(target).catch(() => {});
  }
}
