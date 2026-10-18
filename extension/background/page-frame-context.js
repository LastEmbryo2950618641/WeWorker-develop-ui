import { executeFrameScript, withBrowserFrameContext } from './browser-frames.js';
import { normalizeWorkflowFrames } from './page-workflow-frames.js';

// Experimental foundation, not imported by production routes. The integration
// probe still times out while resolving after an owner replacement; see the
// workflow context audit before wiring this into a generated command.

const fail = (code, message) => Object.assign(new Error(message), { code });
const sourceKey = source => source.sessionId || '';

/** Resolve each unique owner once; subsequent reads retain its real documents. */
export async function resolvePageFrame({ chrome, tabId, frames, ensureCdpAttached, assertRunning = () => {} }) {
  const chain = normalizeWorkflowFrames(frames), objects = [], selected = [], owners = [];
  const deadline = Date.now() + 30000;
  const active = () => { assertRunning(); if (Date.now() >= deadline) throw fail('PAGE_FRAME_TIMEOUT', 'Frame identity preparation exceeded its budget.'); };
  let state;
  const send = async (source, method, params) => { active(); return chrome.debugger.sendCommand(source, method, params); };
  const release = async () => { for (const { source, objectId } of objects) try { await chrome.debugger.sendCommand(source, 'Runtime.releaseObject', { objectId }); } catch {} };
  try {
    const all = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'ISOLATED', func: () => ({ url: location.href }) });
    if (all.length > 50 || !all.some(frame => frame.frameId === 0 && frame.documentId)) throw fail('PAGE_FRAME_UNAVAILABLE', 'The frame tree is unavailable or exceeds 50 documents.');
    const contexts = [];
    for (const frame of all) {
      active();
      await withBrowserFrameContext(chrome, tabId, { frameId: frame.frameId, documentId: frame.documentId }, ensureCdpAttached, async data => {
        state = data.state;
        contexts.push({ selected: data.selected, isolated: data.isolated, context: data.context, url: frame.result.url });
      });
    }
    let parent = contexts.find(frame => frame.selected.frameId === 0);
    selected.push(parent);
    for (const declaration of chain) {
      const expression = `(() => { const nodes = [...document.querySelectorAll(${JSON.stringify(declaration.selector)})]; if(nodes.length !== 1 || !['IFRAME','FRAME'].includes(nodes[0].tagName)) return null; return nodes[0]; })()`;
      const object = await send(parent.isolated.source, 'Runtime.evaluate', { expression, uniqueContextId: parent.isolated.uniqueId });
      if (object.exceptionDetails || !object.result?.objectId) throw fail('PAGE_FRAME_TARGET_CHANGED', 'Choose exactly one iframe owner at every declared level.');
      const objectId = object.result.objectId;
      objects.push({ source: parent.isolated.source, objectId });
      const { node } = await send(parent.isolated.source, 'DOM.describeNode', { objectId });
      const matches = contexts.filter(frame => frame.context.auxData.frameId === node?.frameId);
      if (!node?.frameId || matches.length !== 1) throw fail('PAGE_FRAME_UNAVAILABLE', 'The selected owner has no unique live child document.');
      const child = matches[0], url = new URL(child.url);
      if (url.origin !== declaration.origin || url.pathname !== declaration.pathname) throw fail('PAGE_FRAME_ROUTE_CHANGED', 'The selected frame differs from its declared origin or pathname.');
      const signature = await send(parent.isolated.source, 'Runtime.callFunctionOn', { objectId, functionDeclaration: 'function(){return [this.getAttribute("src"),this.getAttribute("srcdoc")];}', returnByValue: true });
      if (signature.exceptionDetails || !Array.isArray(signature.result?.value)) throw fail('PAGE_FRAME_TARGET_CHANGED', 'The frame owner changed before capture.');
      owners.push({ parent, child, declaration, objectId, signature: signature.result.value });
      selected.push(child); parent = child;
    }
    const assertCurrent = async () => {
      active();
      for (const frame of selected) {
        for (const context of [frame.isolated, frame.context]) if (![...state.contexts.values()].some(item => item.uniqueId === context.uniqueId && sourceKey(item.source) === sourceKey(context.source))) throw fail('PAGE_FRAME_DOCUMENT_CHANGED', 'A selected frame or ancestor document was replaced. No action was replayed.');
        const current = await executeFrameScript(chrome, tabId, frame.selected, () => location.href, []);
        if (current.result !== frame.url) throw fail('PAGE_FRAME_ROUTE_CHANGED', 'A selected frame or ancestor changed its full URL.');
      }
      for (const owner of owners) {
        const result = await send(owner.parent.isolated.source, 'Runtime.callFunctionOn', { objectId: owner.objectId,
          functionDeclaration: 'function(selector, signature){ const nodes=[...this.ownerDocument.querySelectorAll(selector)];return this.isConnected && nodes.length===1 && nodes[0]===this && this.getAttribute("src")===signature[0] && this.getAttribute("srcdoc")===signature[1]; }',
          arguments: [{ value: owner.declaration.selector }, { value: owner.signature }], returnByValue: true });
        if (result.exceptionDetails || result.result?.value !== true) throw fail('PAGE_FRAME_TARGET_CHANGED', 'The frame owner was removed, replaced or became ambiguous.');
        const { node } = await send(owner.parent.isolated.source, 'DOM.describeNode', { objectId: owner.objectId });
        if (node?.frameId !== owner.child.context.auxData.frameId) throw fail('PAGE_FRAME_DOCUMENT_CHANGED', 'The owner no longer refers to the selected frame.');
      }
      active();
    };
    await assertCurrent();
    return { selected: parent.selected, origin: chain.at(-1).origin, pathname: chain.at(-1).pathname, assertCurrent, release };
  } catch (error) { await release(); throw error; }
}
