import { runBrowserPageCommand } from './browser-page.js';
import { browserNetworkUrl, browserNetworkBody } from './browser-network.js';
import { beginBrowserObservations, readBrowserObservations, clearBrowserObservations } from './browser-observations.js';
import { beginBrowserFrames, executeFrameScript, evaluateBrowserFrame } from './browser-frames.js';
import { beginBrowserDownloads, clearBrowserDownloads, markBrowserDownloadAction, readBrowserDownloads, waitBrowserDownload } from './browser-downloads.js';
import { executeFramePointer } from './browser-pointer.js';
import { beginBrowserEvents, clearBrowserEvents, readBrowserEvents, readNetworkEventDetail, browserTimeWindow } from './browser-events.js';
import { browserStateOptions, browserAxReference, readBrowserAxState, validateBrowserAxReference } from './browser-ax.js';

const pageCommands = new Set(['state', 'find', 'get', 'extract', 'click', 'dblclick', 'fill', 'type', 'select', 'check', 'uncheck', 'focus', 'hover', 'scroll']);
const fail = (code, message) => Object.assign(new Error(message), { code });

/** Browser operations are explicit local CLI requests, independent of models. */
export async function executeBrowserCommand({ command, tabId, args = {}, identity }, { chrome, ensureCdpAttached, cdpEvaluate, getCdpNetworkSnapshot, onBrowserDetach = () => {} }) {
  try {
    const identityKey = id => `webcli-browser-tab-${id}`;
    const bind = async id => {
      const key = identityKey(id); const prior = (await chrome.storage.session.get(key))[key];
      const token = prior || crypto.randomUUID(); if (!prior) await chrome.storage.session.set({ [key]: token });
      await ensureCdpAttached(id); beginBrowserObservations(id); beginBrowserDownloads(id); beginBrowserEvents(id);
      markBrowserDownloadAction(id);
      await chrome.debugger.sendCommand({ tabId: id }, 'Runtime.enable');
      await chrome.debugger.sendCommand({ tabId: id }, 'Page.enable');
      await beginBrowserFrames(chrome, id);
      return token;
    };
    // Chrome session storage survives worker suspension/Bridge restarts, but not
    // a browser restart: persisted tab IDs must never target a recycled user tab.
    if (tabId !== undefined && !['bind'].includes(command)) {
      const token = (await chrome.storage.session.get(identityKey(tabId)))[identityKey(tabId)];
      if (!identity || token !== identity) throw fail('SESSION_EXPIRED', 'Browser session identity expired. Unbind and bind the intended tab again.');
    }
    const page = async (operation, input) => {
      const frame = await executeFrameScript(chrome, tabId, input, runBrowserPageCommand, [operation, input]);
      const result = frame.result;
      if (!result?.ok) throw fail(result?.error?.code || 'PAGE_UNAVAILABLE', result?.error?.message || 'The selected frame is unavailable.');
      return { ...result.data, frameId: frame.frameId, documentId: frame.documentId };
    };
    let data;
    if (['open', 'reload', 'back', 'click', 'dblclick', 'fill', 'type', 'select', 'check', 'uncheck', 'keys', 'eval', 'upload', 'drag'].includes(command)) markBrowserDownloadAction(tabId);
    if (command === 'open') {
      const url = new URL(args.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fail('INVALID_ARGUMENT', 'An HTTP(S) URL without credentials is required.');
      const tab = tabId === undefined ? await chrome.tabs.create({ url: url.href, active: !args.background }) : await chrome.tabs.update(tabId, { url: url.href, active: !args.background });
      const token = await bind(tab.id);
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const current = await chrome.tabs.get(tab.id);
        if (current.status === 'complete' && /^https?:/.test(current.url || '')) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return { ok: true, data: { tabId: tab.id, url: url.href, identity: token } };
    }
    if (!Number.isInteger(tabId) || tabId < 0) throw fail('INVALID_ARGUMENT', 'tabId is required.');
    const tab = await chrome.tabs.get(tabId);
    if (!/^https?:\/\//.test(tab.url || '')) throw fail('UNSUPPORTED_PAGE', 'Only HTTP(S) pages are supported.');
    const axReference = typeof args.ref === 'string' && args.ref.startsWith('ax:');
    if (axReference) {
      args = browserAxReference(args);
      await validateBrowserAxReference(chrome, tabId, args, ensureCdpAttached, command);
    }
    if (command === 'state') {
      const options = browserStateOptions(args);
      if (options.source === 'ax' || options.compare) return {ok:true,data:await readBrowserAxState(chrome,tabId,args,ensureCdpAttached)};
    }
    if (command === 'bind') data = { identity: await bind(tabId) };
    else if (['click', 'dblclick', 'hover', 'drag'].includes(command) && (Number(args.frameId) || axReference)) data = await executeFramePointer(chrome, tabId, command, args, ensureCdpAttached);
    else if (['click', 'dblclick', 'hover', 'drag'].includes(command) && !Number(args.frameId)) {
      await ensureCdpAttached(tabId);
      await chrome.debugger.sendCommand({ tabId }, 'Page.bringToFront');
      const { x, y } = await page('bounds', args);
      const from = { x, y };
      const mouse = params => chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', params);
      await mouse({ type: 'mouseMoved', ...from });
      if (command === 'drag') {
        const { x: toX, y: toY } = await page('bounds', { selector: args.toSelector, scrollIntoView: false });
        const to = { x: toX, y: toY };
        const start = from;
        await mouse({ type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 });
        try { for (let i = 1; i <= 10; i++) await mouse({ type: 'mouseMoved', x: start.x + (to.x - start.x) * i / 10, y: start.y + (to.y - start.y) * i / 10, button: 'left', buttons: 1 }); }
        finally { await mouse({ type: 'mouseReleased', ...to, button: 'left', buttons: 0, clickCount: 1 }); }
      } else if (command !== 'hover') {
        for (let count = 1; count <= (command === 'dblclick' ? 2 : 1); count++) {
          await mouse({ type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: count });
          await mouse({ type: 'mouseReleased', ...from, button: 'left', buttons: 0, clickCount: count });
        }
      }
      data = { action: command, completed: true, trusted: true };
    }
    else if (pageCommands.has(command)) data = await page(command, args);
    else if (command === 'upload') {
      await ensureCdpAttached(tabId);
      if (!Array.isArray(args.paths) || !args.paths.length || typeof args.selector !== 'string') throw fail('INVALID_ARGUMENT', 'A selector and file paths are required.');
      const { root } = await chrome.debugger.sendCommand({ tabId }, 'DOM.getDocument');
      const { nodeIds } = await chrome.debugger.sendCommand({ tabId }, 'DOM.querySelectorAll', { nodeId: root.nodeId, selector: args.selector });
      if (nodeIds.length !== 1) throw fail(nodeIds.length ? 'AMBIGUOUS_TARGET' : 'ELEMENT_NOT_FOUND', 'Choose one file input.');
      const { node } = await chrome.debugger.sendCommand({ tabId }, 'DOM.describeNode', { nodeId: nodeIds[0] });
      const attrs = Object.fromEntries((node.attributes || []).reduce((pairs, item, i, all) => i % 2 ? pairs : [...pairs, [item, all[i + 1]]], []));
      if (node.nodeName !== 'INPUT' || attrs.type !== 'file') throw fail('INVALID_ARGUMENT', 'Target must be a file input.');
      if (Object.hasOwn(attrs, 'disabled')) throw fail('ELEMENT_DISABLED', 'The file input is disabled.');
      if (args.paths.length > 1 && !Object.hasOwn(attrs, 'multiple')) throw fail('INVALID_ARGUMENT', 'The file input accepts only one file.');
      await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', { nodeId: nodeIds[0], files: args.paths });
      data = { completed: true, count: args.paths.length };
    }
    else if (command === 'close') { await chrome.tabs.remove(tabId); await chrome.storage.session.remove(identityKey(tabId)); clearBrowserObservations(tabId); clearBrowserDownloads(tabId); data = { closed: true }; }
    else if (command === 'reload') { await chrome.tabs.reload(tabId); data = { reloading: true }; }
    else if (command === 'back') { await chrome.tabs.goBack(tabId); data = { navigating: true }; }
    else if (command === 'eval') {
      if (typeof args.expression !== 'string' || args.expression.length > 100000) throw fail('INVALID_ARGUMENT', 'expression must be a string of at most 100000 characters.');
      data = args.frameId !== undefined || args.documentId !== undefined
        ? await evaluateBrowserFrame(chrome, tabId, args, ensureCdpAttached)
        : { value: await cdpEvaluate(tabId, args.expression) };
    } else if (command === 'frames') {
      const frames = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => ({ url: location.href, title: document.title }) });
      data = { frames: frames.map(item => ({ frameId: item.frameId, documentId: item.documentId, ...item.result })) };
    } else if (command === 'keys') {
      await ensureCdpAttached(tabId);
      await chrome.debugger.sendCommand({ tabId }, 'Page.bringToFront');
      const parts = String(args.key || '').split('+'); const key = parts.pop();
      const modifiers = parts.reduce((bits, part) => bits | ({ Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Shift: 8 }[part] || 0), 0);
      const keyCode = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34, Space: 32 }[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
      if (!keyCode) throw fail('INVALID_ARGUMENT', 'Unsupported keyboard key.');
      const params = { key: key === 'Space' ? ' ' : key, modifiers, windowsVirtualKeyCode: keyCode };
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { ...params, type: 'keyDown', ...(key === 'Enter' ? { text: '\r' } : key.length === 1 && !modifiers ? { text: key } : {}) });
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { ...params, type: 'keyUp' }); data = { sent: true };
    } else if (command === 'screenshot') {
      await ensureCdpAttached(tabId);
      const fullPage = args.fullPage === true || args.fullPage === 'true';
      const metrics = fullPage ? await chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics') : null;
      const size = metrics?.cssContentSize || metrics?.contentSize;
      if (size && size.width * size.height > 40000000) throw fail('SCREENSHOT_TOO_LARGE', 'Full page exceeds 40 million pixels. Use a viewport screenshot.');
      const shot = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage,
        ...(size ? { clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 } } : {}) });
      data = { mimeType: 'image/png', data: shot.data };
    } else if (command === 'console') {
      await ensureCdpAttached(tabId); beginBrowserObservations(tabId);
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
      const state = readBrowserObservations(tabId);
      const after = Number(args.after || 0);
      if (!Number.isSafeInteger(after) || after < 0) throw fail('INVALID_ARGUMENT', 'after must be a non-negative cursor.');
      const { lower, upper } = browserTimeWindow(args);
      const level = args.level === 'warn' ? 'warning' : args.level;
      const entries = state.console.filter(entry => entry.cursor > after && (!level || level === 'all' || entry.level === level)
        && entry.timestamp >= lower && entry.timestamp <= upper && (!args.match || entry.text.includes(String(args.match))));
      const limit = Math.max(1, Math.min(Number(args.limit) || 60, 200));
      const batch = entries.slice(0, limit);
      data = { entries: batch, cursor: batch.at(-1)?.cursor ?? state.sequence, truncated: after < (state.console[0]?.cursor || 1) - 1 };
    } else if (command === 'dialog') {
      await ensureCdpAttached(tabId); beginBrowserObservations(tabId);
      // Page was enabled at bind/open. Re-enabling while a modal is open can
      // itself block; inspection must use the already captured event.
      const action = args.action || 'inspect';
      if (!['inspect', 'accept', 'dismiss'].includes(action)) throw fail('INVALID_ARGUMENT', 'action must be inspect, accept or dismiss.');
      const state = readBrowserObservations(tabId);
      if (action === 'inspect') data = { dialog: state.dialog };
      else {
        if (!state.dialog) throw fail('DIALOG_NOT_FOUND', 'No captured dialog is open.');
        await chrome.debugger.sendCommand({ tabId }, 'Page.handleJavaScriptDialog', { accept: action === 'accept', ...(args.text !== undefined ? { promptText: String(args.text) } : {}) });
        data = { handled: true, action };
      }
    } else if (command === 'events') {
      // An explicit chrome.debugger.detach does not emit onDetach. Validate the
      // attachment without reattaching or evaluating any page code.
      try { await chrome.debugger.sendCommand({ tabId }, 'Runtime.getIsolateId'); }
      catch {
        clearBrowserEvents(tabId); onBrowserDetach(tabId, 'Observation debugger disconnected.');
        throw fail('OBSERVATION_CONTEXT_EXPIRED', 'Browser observation disconnected. Bind the intended tab again; do not reuse the old cursor.');
      }
      data = readBrowserEvents(tabId, args);
    }
    else if (command === 'network') {
      if (typeof args.detail === 'string' && args.detail.startsWith('event:')) return { ok: true, data: await readNetworkEventDetail(chrome, tabId, args.detail) };
      const snapshot = await getCdpNetworkSnapshot(tabId, { businessOnly: !(args.all === true || args.all === 'true'), limit: 200 });
      let entries = snapshot.entries.map(entry => ({ ...entry, key: String(entry.requestId || `${entry.timestamp}:${entry.method}:${entry.url}`) }));
      if (args.match !== undefined) entries = entries.filter(entry => entry.url.includes(String(args.match)));
      const { lower, upper } = browserTimeWindow(args);
      entries = entries.filter(entry => entry.timestamp >= lower && entry.timestamp <= upper);
      if (args.failed === true || args.failed === 'true') entries = entries.filter(entry => !entry.status || entry.status >= 400);
      if (args.detail) {
        const entry = entries.find(item => item.key === String(args.detail));
        if (!entry) throw fail('NETWORK_ENTRY_EXPIRED', 'Network entry is no longer captured. Read browser.network again.');
        // Existing capture redacts sensitive headers; never expose authentication material.
        let body = entry.responsePreview;
        if (entry.requestId) {
          try {
            const captured = await chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId: entry.requestId });
            body = captured.base64Encoded ? new TextDecoder().decode(Uint8Array.from(atob(captured.body), c => c.charCodeAt(0))) : captured.body;
          } catch { /* Fall back to captured preview, with explicit omission if truncated. */ }
        }
        data = { entry: { key: entry.key, url: browserNetworkUrl(entry.url), method: entry.method, status: entry.status,
          contentType: entry.responseContentType, request: browserNetworkBody(entry.requestBodyPreview),
          response: String(body || '').length > 500000 ? { omitted: true, reason: 'Body exceeds 500000 characters.' } : browserNetworkBody(body) } };
      } else data = { source: snapshot.source, totalEntries: entries.length, entries: entries.slice(0, Math.min(Number(args.limit) || 60, 200)).map(entry => ({ key: entry.key, url: browserNetworkUrl(entry.url), method: entry.method, status: entry.status, timestamp: entry.timestamp, contentType: entry.responseContentType })) };
    } else if (command === 'downloads') data = readBrowserDownloads(tabId, args);
    else if (command === 'wait' && args.kind === 'download') data = await waitBrowserDownload(chrome, tabId, args);
    else if (command === 'wait') {
      if (args.after !== undefined || args.downloadId !== undefined) throw fail('INVALID_ARGUMENT', 'after/downloadId are only valid for download waits.');
      const timeout = Math.max(0, Math.min(Number(args.timeoutMs) || 10000, 30000));
      const started = Date.now(); const value = String(args.value ?? '');
      if (args.kind === 'time') {
        const ms = Number(value); if (!Number.isFinite(ms) || ms < 0 || ms > 30000) throw fail('INVALID_ARGUMENT', 'Time must be 0–30000 milliseconds.');
        await new Promise(resolve => setTimeout(resolve, ms)); data = { matched: true };
      } else {
        if (!['selector', 'text', 'xhr'].includes(args.kind)) throw fail('INVALID_ARGUMENT', 'Wait kind must be time, selector, text or xhr.');
        do {
          if (args.kind === 'xhr') {
            const network = await getCdpNetworkSnapshot(tabId, { limit: 200 });
            if (network.entries.some(entry => entry.url.includes(value) && entry.status)) { data = { matched: true }; break; }
          } else {
            const frame = { frameId: args.frameId, documentId: args.documentId };
            const result = args.kind === 'selector' ? await page('find', { selector: value, ...frame }) : await page('extract', { maxChars: 200000, ...frame });
            if (args.kind === 'selector' ? result.matches > 0 : result.text.includes(value)) { data = { matched: true }; break; }
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        } while (Date.now() - started < timeout);
        if (!data) throw fail('WAIT_TIMEOUT', 'The requested condition was not observed before timeout.');
      }
    } else throw fail('UNKNOWN_COMMAND', 'Unsupported browser command.');
    return { ok: true, data };
  } catch (error) { return { ok: false, error: { code: error.code || 'BROWSER_OPERATION_FAILED', message: error.code ? error.message : 'Browser operation failed; refresh the page state or connection.', ...(error.details ? { details: error.details } : {}) } }; }
}
