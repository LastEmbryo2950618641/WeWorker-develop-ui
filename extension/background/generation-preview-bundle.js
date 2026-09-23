/** Bind every preview script to the same task's globals and registration sink. */
export function scopedGenerationPreviewScripts(scripts, token) {
  if (!/^[a-f0-9-]{36}$/.test(token || '')) throw new Error('Invalid preview session token');
  return scripts.map(script => ({
    path: script.path,
    source: `(async function (window) {
      const globalThis = window, self = window;
      const __webmcpRegister = (...args) => window.__webmcpRegister(...args);
      const __webcliRegisterCommand = (...args) => window.__webcliRegisterCommand(...args);
      const __webmcpWecliRuntime = window.__webmcpWecliRuntime;
      ${script.source}
    })(globalThis.__weworkerPreviewRegistry.scope(${JSON.stringify(token)}));`,
  }));
}
