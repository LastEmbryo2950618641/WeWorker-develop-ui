/** Self-contained function injected into MAIN. Never calls a page getter or evaluates source text. */
export function readPageSource({ source, expectedOrigin, expectedPath, metadataOnly = false }) {
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
  const sensitive = /password|passwd|secret|cookie|authorization|credential|api.?key|csrf|session|token/i;
  const unsafe = key => ['__proto__', 'prototype', 'constructor', 'window', 'globalThis', 'document', 'localStorage', 'sessionStorage'].includes(key) || sensitive.test(key);
  const own = (value, key) => {
    if (unsafe(key)) fail('PAGE_SOURCE_SENSITIVE', 'Choose a public data path without credentials or browser storage.');
    if (value == null || !['object', 'function'].includes(typeof value)) fail('PAGE_SOURCE_MISSING', 'The selected state path is unavailable.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) fail('PAGE_SOURCE_MISSING', 'The selected state path is unavailable.');
    if (!Object.hasOwn(descriptor, 'value')) fail('PAGE_SOURCE_ACCESSOR', 'State getters are not invoked. Select a plain data property.');
    return descriptor.value;
  };
  let nodes = 0, characters = 0;
  const copy = (value, depth = 0) => {
    if (++nodes > 20000 || depth > 10) fail('PAGE_SOURCE_TOO_LARGE', 'Select a smaller data subtree.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      characters += value.length;
      if (characters > 500000) fail('PAGE_SOURCE_TOO_LARGE', 'Selected data exceeds 500000 characters.');
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > 1000) fail('PAGE_SOURCE_TOO_LARGE', 'Select a state array with at most 1000 entries.');
      return Array.from({ length: value.length }, (_, i) => copy(own(value, String(i)), depth + 1));
    }
    if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length > 100) fail('PAGE_SOURCE_TOO_LARGE', 'Select an object with at most 100 fields.');
      return Object.fromEntries(keys.map(key => [key, copy(own(value, key), depth + 1)]));
    }
    fail('PAGE_SOURCE_NOT_JSON', 'Selected state must contain finite JSON data.');
  };
  const shape = (value, depth = 0) => {
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value;
    if (depth >= 8) return { type };
    if (type === 'array') return { type, length: value.length, items: value.length ? shape(value[0], depth + 1) : { type: 'unknown' } };
    if (type === 'object') return { type, properties: Object.fromEntries(Object.entries(value).filter(([key]) => /^[a-zA-Z_$][a-zA-Z0-9_$-]{0,99}$/.test(key)).map(([key, child]) => [key, shape(child, depth + 1)])) };
    return { type };
  };
  const visible = node => !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  try {
    if (location.origin !== expectedOrigin || location.pathname !== expectedPath) fail('PAGE_SOURCE_ROUTE_CHANGED', 'Open the observed page route before calling this command.');
    if (!source || !['UI_SELECTOR', 'DOM_STATE'].includes(source.strategy)) fail('INVALID_PAGE_SOURCE', 'Unsupported page strategy.');
    let data;
    if (source.strategy === 'UI_SELECTOR') {
      const rows = [...document.querySelectorAll(source.selector)].filter(visible);
      if (!rows.length && !(source.emptySelector && [...document.querySelectorAll(source.emptySelector)].some(visible))) fail('PAGE_SOURCE_MISSING', 'No rows or verified empty-state marker matched.');
      const limit = source.limit || 200;
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !source.fields || Object.keys(source.fields).length > 30) fail('INVALID_PAGE_SOURCE', 'Invalid DOM fields or row limit.');
      const items = rows.slice(0, limit).map(row => Object.fromEntries(Object.entries(source.fields).map(([name, field]) => {
        if (unsafe(name) || (field.attribute && (unsafe(field.attribute) || /^on/i.test(field.attribute)))) fail('PAGE_SOURCE_SENSITIVE', 'Sensitive output fields are not supported.');
        const matches = field.selector ? [...row.querySelectorAll(field.selector)] : [row];
        if (matches.length > 1) fail('PAGE_FIELD_AMBIGUOUS', 'A field selector matched more than one element in a row.');
        const node = matches[0];
        if (!node) { if (field.optional) return [name, null]; fail('PAGE_FIELD_MISSING', 'A required field selector did not match in every row.'); }
        if (['INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE'].includes(node.tagName)) fail('PAGE_SOURCE_SENSITIVE', 'Select visible content, not inputs, scripts or styles.');
        if (!visible(node)) { if (field.optional) return [name, null]; fail('PAGE_FIELD_MISSING', 'A required field is not visible.'); }
        const value = field.attribute ? node.getAttribute(field.attribute) : (node.innerText ?? node.textContent).trim();
        if (value === null && !field.optional) fail('PAGE_FIELD_MISSING', 'A required attribute is missing.');
        return [name, value];
      })));
      data = copy({ items, matchedCount: rows.length, truncated: rows.length > limit });
    } else {
      if (!Array.isArray(source.path) || source.path.length > 16 || (!source.jsonSelector && !source.path.length)) fail('INVALID_PAGE_SOURCE', 'Choose a state path or JSON script.');
      let value = window;
      if (source.jsonSelector) {
        const scripts = [...document.querySelectorAll(source.jsonSelector)];
        if (scripts.length !== 1 || scripts[0].tagName !== 'SCRIPT' || !/^(application\/(?:ld\+)?json)$/i.test(scripts[0].type)) fail('PAGE_SOURCE_MISSING', 'Choose one application/json or application/ld+json script.');
        if (scripts[0].textContent.length > 1000000) fail('PAGE_SOURCE_TOO_LARGE', 'JSON script exceeds one million characters.');
        try { value = JSON.parse(scripts[0].textContent); } catch { fail('PAGE_SOURCE_NOT_JSON', 'The selected script is not valid JSON.'); }
      }
      for (const key of source.path) value = own(value, String(key));
      data = copy(value);
    }
    return { ok: true, ...(metadataOnly ? { shape: shape(data) } : { data }) };
  } catch (error) { return { ok: false, error: { code: error.code || 'INVALID_PAGE_SOURCE', message: error.code ? error.message : 'Invalid page selector or data source.' } }; }
}

export async function executePageSource(chrome, tabId, payload) {
  const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN', func: readPageSource, args: [payload] });
  return result || { ok: false, error: { code: 'PAGE_SOURCE_MISSING', message: 'The observed page is unavailable.' } };
}
