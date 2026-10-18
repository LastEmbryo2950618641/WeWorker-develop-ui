// Task-local registration and globals for preview packages. This is execution
// isolation, not a security sandbox for untrusted JavaScript or DOM access.
(() => {
  if (window.__weworkerPreviewRegistry) return;
  const sessions = new Map();
  const finish = token => {
    const session = sessions.get(token);
    if (session) clearTimeout(session.timer);
    sessions.delete(token);
  };
  const requireSession = token => {
    const session = sessions.get(token);
    if (!session || (session.allowQueryChanges ? session.route !== window.location.href.split(/[?#]/)[0] : session.url !== window.location.href)) throw new Error('Preview session expired or document changed');
    return session;
  };
  const begin = ({ token, siteKey, previewAdapterId = null, packageDigest = null, allowQueryChanges = false }) => {
    if (!/^[a-f0-9-]{36}$/.test(token || '') || !siteKey || window.location.hostname !== siteKey) throw new Error('Invalid preview target');
    if (packageDigest !== null && !/^[a-f0-9]{64}$/.test(packageDigest)) throw new Error('Invalid preview package digest');
    if (sessions.size) throw new Error('Another preview is active on this document');
    const session = { previewAdapterId, packageDigest, allowQueryChanges, route: window.location.href.split(/[?#]/)[0], url: window.location.href, tools: [], handlers: new Map(), timer: setTimeout(() => finish(token), 300000) };
    const globals = Object.create(null);
    let scope;
    globals.__webmcpRegister = adapter => {
      requireSession(token);
      for (const tool of adapter.tools || []) {
        const name = tool.publicName || tool.name;
        if (typeof tool.handler !== 'function' || session.handlers.has(name)) throw new Error('Invalid or duplicate preview command');
        session.handlers.set(name, tool.handler);
        if (!tool.internal) session.tools.push({ name, publicName: name, description: tool.description || '', parameters: tool.parameters || {}, generationSource: tool.generationSource || null });
      }
    };
    scope = new Proxy(globals, {
      get(target, key) {
        if (['window', 'self', 'globalThis'].includes(key)) return scope;
        if (Object.hasOwn(target, key)) return target[key];
        // A preview must never reuse an installed package's mutable runtime.
        if (typeof key === 'string' && (/^__webmcp|^__webcli|^__weworkerPreview/.test(key))) return undefined;
        const value = window[key];
        return typeof value === 'function' ? value.bind(window) : value;
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    session.scope = scope;
    sessions.set(token, session);
  };
  window.__weworkerPreviewRegistry = { scope: token => requireSession(token).scope };
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (!['begin_generation_preview', 'get_generation_preview', 'call_generation_preview', 'end_generation_preview'].includes(msg.type)) return;
    try {
      if (msg.type === 'end_generation_preview') { finish(msg.token); respond({ ok: true }); return true; }
      if (msg.type === 'begin_generation_preview') { begin(msg); respond({ ok: true }); return true; }
      const session = requireSession(msg.token);
      if (msg.type === 'get_generation_preview') { respond({ ok: true, tools: session.tools, previewAdapterId: session.previewAdapterId, packageDigest: session.packageDigest }); return true; }
      const handler = session.handlers.get(msg.toolName);
      if (!handler) throw new Error('Preview command is not registered');
      Promise.resolve().then(() => handler(msg.args || {}, msg.continuation)).then(result => {
        requireSession(msg.token);
        respond({ result });
      }).catch(error => respond({ error: error.message || String(error) }));
    } catch (error) { respond({ ok: false, error: error.message || String(error) }); }
    return true;
  });
  window.addEventListener('pagehide', () => { for (const token of sessions.keys()) finish(token); });
})();
