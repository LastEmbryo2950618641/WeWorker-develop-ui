const fail = () => { throw Object.assign(new Error('Invalid native UI write contract.'), { code: 'INVALID_UI_WRITE' }); };
export function uiWriteRequest(command, args) {
  const spec = command.uiWrite;
  if (!spec || spec.version !== 1 || spec.method !== 'POST' || spec.inputMode !== 'native-setter-no-events'
    || command.runtime !== 'extension' || command.safety !== 'write' || command.requires_confirmation === false || command.pageWrite || command.pageWorkflow || command.execution
    || !Array.isArray(spec.inputs) || !spec.inputs.length || spec.inputs.length > 10) fail();
  if (args?.__confirmed !== true) throw Object.assign(new Error('Explicit confirmation is required.'), { code: 'CONFIRMATION_REQUIRED' });
  const names = spec.inputs.map(v => v.parameter);
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => k !== '__confirmed' && !names.includes(k))
    || names.some(k => typeof args[k] !== 'string' || args[k].length > 10000 || /[\r\n\0]/.test(args[k])) || !args[spec.confirmation?.parameter]?.trim()) fail();
  return { url: spec.url, method: 'POST', body: Object.fromEntries(spec.inputs.map(v => [v.name, args[v.parameter]])) };
}

/** Runs only in the retained isolated main document. No events during filling. */
export async function pageUiSubmit(input) {
  let submitted = false;
  const error = code => { throw Object.assign(new Error(code), { code }); };
  const current = () => {
    if (Date.now() >= input.deadline) error('UI_WRITE_TIMEOUT');
    if (location.href !== input.documentUrl || globalThis.__weworkerWriteDocumentToken !== input.documentToken) error('PAGE_WRITE_DOCUMENT_CHANGED');
  };
  const unique = (root, selector) => {
    const nodes = root.querySelectorAll(selector);
    if (nodes.length !== 1) error('UI_WRITE_TARGET_AMBIGUOUS');
    return nodes[0];
  };
  const visible = node => {
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    return node.isConnected && rect.width > 0 && rect.height > 0 && style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) > 0 && !node.closest('[inert],[hidden]');
  };
  try {
    current();
    const spec = input.ui;
    if (!spec || spec.version !== 1 || spec.method !== 'POST' || spec.inputMode !== 'native-setter-no-events'
      || spec.url !== input.request.url || input.request.method !== 'POST' || !Array.isArray(spec.inputs) || !spec.inputs.length || spec.inputs.length > 10) error('INVALID_UI_WRITE');
    if (spec.result !== undefined && (!spec.result || Object.keys(spec.result).sort().join(',') !== 'attribute,idType,publicId'
      || spec.result.publicId !== true || !['string', 'integer'].includes(spec.result.idType)
      || !/^data-[a-z][a-z0-9-]{0,63}$/.test(spec.result.attribute)
      || /token|cookie|auth|password|secret|session|credential|api.?key|csrf|ticket|prototype|constructor/i.test(spec.result.attribute)
      || spec.result.attribute === spec.confirmation.attribute)) error('INVALID_UI_WRITE');
    const form = unique(document, spec.form), submit = unique(form, spec.submit.selector), receipt = unique(document, spec.confirmation.selector);
    const previousId = spec.result ? receipt.getAttribute(spec.result.attribute) : null;
    const entries = spec.inputs.map(binding => ({ binding, node: unique(form, binding.selector) }));
    const correlate = entries.find(v => v.binding.parameter === spec.confirmation.parameter);
    if (!correlate || Object.keys(input.request.body).length !== entries.length || entries.some(({ binding }) => typeof input.request.body[binding.name] !== 'string')) error('INVALID_UI_WRITE');
    const wanted = input.request.body[correlate.binding.name];
    const inspect = () => {
      current();
      if (!(form instanceof HTMLFormElement) || form.action !== spec.url || form.method !== 'post' || form.target && form.target !== '_self'
        || form.enctype !== 'application/x-www-form-urlencoded' || form.noValidate || !visible(form)
        || unique(document, spec.form) !== form || unique(form, spec.submit.selector) !== submit || unique(document, spec.confirmation.selector) !== receipt
        || !(submit instanceof HTMLButtonElement) || submit.type !== 'submit' || submit.form !== form || submit.name || submit.matches(':disabled') || !visible(submit)
        || ['formaction', 'formmethod', 'formenctype', 'formtarget', 'formnovalidate'].some(k => submit.hasAttribute(k))
        || submit.textContent.trim() !== spec.submit.text) error('UI_WRITE_TARGET_CHANGED');
      for (const { binding, node } of entries) {
        if (unique(form, binding.selector) !== node || !visible(node) || node.form !== form || node.name !== binding.name || node.matches(':disabled') || node.readOnly
          || !(node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement && ['text', 'search'].includes(node.type))) error('UI_WRITE_INPUT_UNSUPPORTED');
      }
      // Extra successful fields (including hidden fields) need a future explicit
      // contract. Never silently submit captured data or credentials.
      if (new Set(entries.map(v => v.node)).size !== entries.length || [...form.elements].some(node => node.name && !node.matches(':disabled') && !entries.some(v => v.node === node))) error('UI_WRITE_EXTRA_FIELDS');
      if (!visible(receipt) || !/^data-[a-z][a-z0-9-]*$/.test(spec.confirmation.attribute) || !wanted?.trim() || receipt.getAttribute(spec.confirmation.attribute) === wanted) error('UI_WRITE_STALE_CONFIRMATION');
      if (spec.result && receipt.getAttribute(spec.result.attribute) !== previousId) error('UI_WRITE_TARGET_CHANGED');
    };
    inspect();
    for (const { binding, node } of entries) {
      const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, input.request.body[binding.name]);
    }
    inspect();
    if (entries.some(({ binding, node }) => node.value !== input.request.body[binding.name]) || [...form.elements].some(node => node.willValidate && !node.validity.valid)) error('UI_WRITE_INPUT_REJECTED');
    // No Enter, click fallback, retry, or second submit. requestSubmit invokes
    // native validation/submit events; controls depending on click are excluded.
    current(); submitted = true;
    HTMLFormElement.prototype.requestSubmit.call(form, submit);
    while (true) {
      current();
      if (!form.isConnected || unique(document, spec.form) !== form || !receipt.isConnected || unique(document, spec.confirmation.selector) !== receipt) error('UI_WRITE_TARGET_CHANGED');
      if (receipt.getAttribute(spec.confirmation.attribute) === wanted && visible(receipt)) {
        let resultId;
        if (spec.result) {
          const raw = receipt.getAttribute(spec.result.attribute);
          if (raw === previousId) error('UI_WRITE_STALE_RESULT_ID');
          // DOM attributes are text. Explicit integer mode parses only canonical
          // non-negative decimal; string mode preserves leading zeros/Unicode.
          const valid = typeof raw === 'string' && (spec.result.idType === 'integer'
            ? /^(0|[1-9][0-9]{0,15})$/.test(raw) && Number.isSafeInteger(Number(raw))
            : raw.length > 0 && raw.length <= 512 && raw !== '.' && raw !== '..' && /^[\p{L}\p{N}_.-]+$/u.test(raw));
          if (!valid) error('UI_WRITE_RESULT_ID_INVALID');
          resultId = spec.result.idType === 'integer' ? Number(raw) : raw;
        }
        return { ok: true, value: { ok: true, submitted: true, confirmationMatched: true, effectVerified: false, ...(spec.result ? { resultId } : {}) }, submitted };
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } catch (cause) { return { ok: false, error: { code: cause.code || 'UI_WRITE_FAILED' }, submitted }; }
}
