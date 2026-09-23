/**
 * Profile-scoped Adapter state watcher.
 *
 * The registry revision is the commit boundary: every installer operation that
 * changes effective packages writes a new revision before returning. Hosts can
 * poll this file from a long-lived process without coupling CLI, Hub, generated
 * packages and Backend to one another.
 */
import { readAdapterState } from './adapter-state.js';

function stateSnapshot(paths) {
  const state = readAdapterState(paths);
  return {
    revision: state.revision,
    installations: state.installations,
    selections: state.selections,
    development: state.development,
  };
}

function changedAdapterNames(before, after) {
  const names = new Set();
  for (const collection of ['installations', 'selections', 'development']) {
    const left = before[collection] || Object.create(null);
    const right = after[collection] || Object.create(null);
    for (const name of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (JSON.stringify(left[name]) !== JSON.stringify(right[name])) names.add(name);
    }
  }
  return [...names].sort();
}

export function watchAdapterState(paths, onEvent, { intervalMs = 250, onError = () => {} } = {}) {
  if (!paths || typeof paths !== 'object') throw new Error('Adapter state paths are required.');
  if (typeof onEvent !== 'function') throw new Error('Adapter state event handler is required.');
  if (!Number.isFinite(intervalMs) || intervalMs < 20) throw new Error('Adapter state polling interval must be at least 20ms.');
  let stopped = false;
  let previous = null;
  let lastRevision = 0;
  let previousRevision = 0;
  const initialize = () => {
    previous = stateSnapshot(paths);
    lastRevision = previous.revision;
    previousRevision = previous.revision;
  };
  try { initialize(); }
  catch (error) { onError(error); }

  const poll = async () => {
    if (stopped) return;
    let next;
    try { next = stateSnapshot(paths); }
    catch (error) { onError(error); return; }
    if (next.revision === lastRevision) return;
    const event = {
      type: 'adapter_state_changed',
      profile: paths.profile,
      previousRevision,
      revision: next.revision,
      adapters: previous ? changedAdapterNames(previous, next) : [],
    };
    previous = next;
    lastRevision = next.revision;
    previousRevision = next.revision;
    try { await onEvent(event); }
    catch (error) { onError(error); }
  };

  const snapshot = () => previous ? {
    type: 'adapter_state_changed',
    profile: paths.profile,
    previousRevision: previous.revision,
    revision: previous.revision,
    adapters: [],
    sync: true,
  } : null;

  const timer = setInterval(() => { void poll(); }, intervalMs);
  timer.unref?.();
  return {
    poll,
    snapshot,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
    get isStopped() { return stopped; },
  };
}
