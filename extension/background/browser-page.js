/** Injected as a function into an isolated world. Keep all helpers inside. */
export async function runBrowserPageCommand(command, args = {}) {
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
  try {
    const limit = Math.max(1, Math.min(Number(args.limit) || 100, 200));
    const visible = node => !!(node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
    const role = node => node.getAttribute('role') || ({ BUTTON: 'button', A: 'link', TEXTAREA: 'textbox', SELECT: 'combobox' }[node.tagName])
      || (node.tagName === 'INPUT' ? ({ checkbox: 'checkbox', radio: 'radio', search: 'searchbox', submit: 'button', button: 'button' }[node.type] || 'textbox') : '');
    const label = node => (node.getAttribute('aria-label') || (node.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim()
      || [...(node.labels || [])].map(item => item.textContent).join(' ') || node.getAttribute('placeholder') || node.textContent || '').trim().slice(0, 500);
    const describe = (node, ref) => ({ ref, tag: node.tagName.toLowerCase(), role: role(node), name: label(node),
      ...(node.id ? { id: node.id } : {}), ...(node.getAttribute('type') ? { type: node.getAttribute('type') } : {}),
      disabled: Boolean(node.disabled), ...(node.type === 'checkbox' || node.type === 'radio' ? { checked: node.checked } : {}) });
    const query = () => {
      if (args.ref) {
        const snapshot = globalThis.__weworkerBrowserSnapshot;
        const found = snapshot?.refs.get(String(args.ref));
        if (!found || !found.node.isConnected || snapshot.url !== location.href || found.label !== label(found.node)) fail('STALE_REF', 'Reference expired. Read browser.state/find again or use a selector.');
        return [found.node];
      }
      let nodes;
      try { nodes = [...document.querySelectorAll(args.selector || '*')]; }
      catch { fail('INVALID_SELECTOR', 'Invalid CSS selector.'); }
      if (args.role) nodes = nodes.filter(node => role(node) === args.role);
      if (args.name !== undefined) nodes = nodes.filter(node => label(node) === String(args.name));
      if (args.text !== undefined) nodes = nodes.filter(node => node.textContent.trim() === String(args.text) && ![...node.children].some(child => child.textContent.trim() === String(args.text)));
      return nodes.filter(visible);
    };
    const one = () => {
      if (!args.selector && !args.ref && !args.role && args.text === undefined) fail('INVALID_ARGUMENT', 'Provide selector, ref, role/name or text.');
      const nodes = query();
      if (!nodes.length) fail('ELEMENT_NOT_FOUND', 'No visible element matches the target.');
      if (nodes.length > 1) fail('AMBIGUOUS_TARGET', `${nodes.length} elements match. Use a more specific target.`);
      return nodes[0];
    };
    if (command === 'state' || command === 'find') {
      const nodes = command === 'find' ? query() : [...document.querySelectorAll('a[href],button,input,textarea,select,[role],[contenteditable="true"],[tabindex]')].filter(visible);
      const snapshotId = crypto.randomUUID(); const refs = new Map();
      const elements = nodes.slice(0, limit).map((node, index) => { const ref = `${snapshotId}:${index + 1}`; refs.set(ref, { node, label: label(node) }); return describe(node, ref); });
      globalThis.__weworkerBrowserSnapshot = { refs, url: location.href };
      return { ok: true, data: { url: location.href, title: document.title, snapshotId, matches: nodes.length, elements,
        ...(command === 'state' ? { text: document.body?.innerText.slice(0, 12000) || '' } : {}) } };
    }
    if (command === 'extract') {
      const node = args.selector || args.ref || args.role || args.text !== undefined ? one() : document.body;
      const text = node?.innerText || node?.textContent || '';
      const max = Math.max(1, Math.min(Number(args.maxChars) || 20000, 200000));
      return { ok: true, data: { text: text.slice(0, max), truncated: text.length > max, url: location.href } };
    }
    if (command === 'scroll') {
      const node = args.selector || args.ref || args.role ? one() : window;
      const amount = Math.max(1, Math.min(Number(args.amount) || 600, 10000));
      const direction = args.direction || 'down';
      if (!['up', 'down', 'left', 'right', 'top', 'bottom'].includes(direction)) fail('INVALID_ARGUMENT', 'Unknown scroll direction.');
      if (direction === 'top' || direction === 'bottom') node.scrollTo({ top: direction === 'top' ? 0 : (node === window ? document.documentElement.scrollHeight : node.scrollHeight), behavior: 'instant' });
      else node.scrollBy({ top: direction === 'up' ? -amount : direction === 'down' ? amount : 0, left: direction === 'left' ? -amount : direction === 'right' ? amount : 0, behavior: 'instant' });
      return { ok: true, data: { scrolled: true, direction } };
    }
    const node = one();
    if (command === 'get') {
      if (node.type === 'password') fail('SENSITIVE_FIELD', 'Password field contents are not returned.');
      const property = args.property || 'text';
      const readers = { text: () => node.innerText || node.textContent, value: () => node.value, html: () => node.outerHTML, attribute: () => node.getAttribute(String(args.attribute || '')) };
      if (!readers[property]) fail('INVALID_ARGUMENT', 'property must be text, value, html or attribute.');
      return { ok: true, data: { value: String(readers[property]() ?? '').slice(0, 100000), element: describe(node) } };
    }
    if (node.disabled) fail('ELEMENT_DISABLED', 'The target element is disabled.');
    if (args.scrollIntoView !== false) node.scrollIntoView({ block: 'center', inline: 'center' });
    if (command === 'bounds') {
      const rect = node.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) fail('ELEMENT_OFFSCREEN', 'The target is outside the viewport. Scroll it into view first.');
      const x = Math.max(0, rect.left) + (Math.min(innerWidth, rect.right) - Math.max(0, rect.left)) / 2;
      const y = Math.max(0, rect.top) + (Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)) / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || (hit !== node && !node.contains(hit))) fail('ELEMENT_OBSCURED', 'Another element covers this target. Inspect the current page.');
      return { ok: true, data: { x, y } };
    }
    if (command === 'click' || command === 'dblclick') {
      node.click(); if (command === 'dblclick') { node.click(); node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })); }
    } else if (command === 'focus') node.focus();
    else if (command === 'hover') {
      node.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); node.dispatchEvent(new MouseEvent('mouseenter'));
    } else if (command === 'fill' || command === 'type') {
      if (node.readOnly) fail('ELEMENT_READONLY', 'The field is read-only.');
      if (node.type === 'file') fail('INVALID_ARGUMENT', 'Use browser.upload for file inputs.');
      if (!['INPUT', 'TEXTAREA'].includes(node.tagName) && !node.isContentEditable) fail('NOT_EDITABLE', 'Target is not an editable field.');
      node.focus();
      const value = (command === 'type' ? (node.isContentEditable ? node.textContent : node.value) : '') + String(args.value ?? '');
      if (node.isContentEditable) node.textContent = value;
      else Object.getOwnPropertyDescriptor(node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(node, value);
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(args.value ?? '') })); node.dispatchEvent(new Event('change', { bubbles: true }));
      if ((node.isContentEditable ? node.textContent : node.value) !== value) fail('INPUT_REJECTED', 'The page did not retain the supplied input.');
    } else if (command === 'select') {
      if (node.tagName !== 'SELECT') fail('INVALID_ARGUMENT', 'Target is not a native select.');
      const values = (Array.isArray(args.value) ? args.value : [args.value]).map(String);
      if (!node.multiple && values.length !== 1) fail('INVALID_ARGUMENT', 'This select accepts one option.');
      const options = values.map(value => [...node.options].find(option => option.value === value || option.textContent.trim() === value));
      if (options.some(option => !option || option.disabled)) fail('OPTION_NOT_FOUND', 'An option is missing or disabled.');
      for (const option of node.options) option.selected = options.includes(option);
      node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (command === 'check' || command === 'uncheck') {
      const desired = command === 'check';
      const current = () => ['checkbox', 'radio'].includes(node.type) ? node.checked : node.getAttribute('aria-checked') === 'true';
      if (!['checkbox', 'radio'].includes(node.type) && !node.hasAttribute('aria-checked')) fail('INVALID_ARGUMENT', 'Target is not checkable.');
      if (current() !== desired) node.click();
      if (current() !== desired) fail('CHECK_FAILED', 'The page did not reach the requested checked state.');
    } else fail('UNKNOWN_COMMAND', 'Unsupported page command.');
    return { ok: true, data: { action: command, completed: true, element: describe(node) } };
  } catch (error) { return { ok: false, error: { code: error.code || 'PAGE_OPERATION_FAILED', message: error.message } }; }
}
