import { normalizeWorkflowOrigin } from './page-workflow-origins.js';

// Unintegrated foundation: no generated workflow schema/capability uses this.

/** Persist owner declarations, never a transient browser frame/document ID. */
export function normalizeWorkflowFrames(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new Error('Declare 1–8 nested frame owners.');
  return value.map(frame => {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) || Object.keys(frame).some(key => !['selector', 'origin', 'pathname'].includes(key))) throw new Error('Each frame declares only selector, origin and pathname.');
    if (typeof frame.selector !== 'string' || !frame.selector.trim() || frame.selector.length > 1000 || /[\u0000-\u001f\u007f]/.test(frame.selector)) throw new Error('Declare a unique iframe owner selector.');
    const origin = normalizeWorkflowOrigin(frame.origin);
    let url; try { url = new URL(origin + frame.pathname); } catch {}
    if (typeof frame.pathname !== 'string' || frame.pathname.length > 2048 || !/^\/(?!\/)/.test(frame.pathname) || !url || url.origin !== origin
      || url.pathname !== frame.pathname || url.search || url.hash || frame.pathname.includes(':id')) throw new Error('Declare an exact public frame pathname.');
    return { selector: frame.selector, origin, pathname: frame.pathname };
  });
}
export const usesWorkflowFrames = source => Boolean(source?.steps?.some(step => step.frames));
export const workflowFrameOrigins = source => [...new Set((source?.steps || []).flatMap(step => (step.frames || []).map(frame => frame.origin)))];
