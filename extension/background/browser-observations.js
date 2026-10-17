// Explicit browser sessions keep bounded diagnostics in memory, never on disk.
const observations = new Map();
export function beginBrowserObservations(tabId) {
  if (!observations.has(tabId)) observations.set(tabId, { console: [], dialog: null, sequence: 0 });
}
export function clearBrowserObservations(tabId) { observations.delete(tabId); }
export function recordBrowserObservation(tabId, method, params) {
  const state = observations.get(tabId); if (!state) return;
  if (method === 'Runtime.consoleAPICalled' || method === 'Runtime.exceptionThrown') {
    const text = method === 'Runtime.consoleAPICalled'
      ? (params.args || []).map(arg => typeof arg.value === 'object' ? '[object]' : String(arg.value ?? arg.description ?? arg.type)).join(' ')
      : String(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Page exception');
    state.console.push({ cursor: ++state.sequence, level: params.type || 'error', text: text.slice(0, 8000), timestamp: Date.now() });
    state.console = state.console.slice(-200);
  } else if (method === 'Page.javascriptDialogOpening') {
    state.dialog = { type: params.type, message: String(params.message || '').slice(0, 8000) };
  } else if (method === 'Page.javascriptDialogClosed') state.dialog = null;
}
export function readBrowserObservations(tabId) { return observations.get(tabId) || { console: [], dialog: null, sequence: 0 }; }
