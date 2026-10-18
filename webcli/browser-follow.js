import { setTimeout as delay } from 'node:timers/promises';
import { callLocalCommand } from './exploration-client.js';
import { browserCommands } from './browser-commands.js';

const failure = (code, message) => Object.assign(new Error(message), { code });
function number(value, fallback, min, max, name) {
  const result = value === undefined ? fallback : (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) ? Number(value) : NaN;
  if (!Number.isSafeInteger(result) || result < min || result > max) throw failure('INVALID_ARGUMENT', `${name} must be an integer from ${min} to ${max}.`);
  return result;
}

/** Agent-neutral JSON Lines protocol, driven by the same poll API a UI can use. */
export async function followBrowser(command, args, { request = (args, options) => callLocalCommand('browser', 'events', args, options),
  emit, signal, profile = process.env.WEBCLI_PROFILE, now = Date.now, sleep = (ms, signal) => delay(ms, undefined, { signal }) } = {}) {
  const envelope = { schemaVersion: 1, command: `browser.${command}`, session: args.session };
  let connectionId;
  let currentCursor = args.cursor, count = 0, ready = false;
  try {
    if (!['console', 'network'].includes(command)) throw failure('INVALID_ARGUMENT', 'follow is available for console/network.');
    const spec = browserCommands[command];
    for (const key of Object.keys(args)) if (!spec.params.includes(key) && !spec.params.includes(key + '?')) throw failure('INVALID_ARGUMENT', `Unknown argument: ${key}`);
    if (args.detail !== undefined || args.after !== undefined) throw failure('INVALID_ARGUMENT', 'follow cannot combine with detail or legacy after. Use its opaque event cursor.');
    const duration = number(args.durationMs, 0, 0, 86400000, 'durationMs');
    const maxEvents = number(args.maxEvents, 0, 0, 1000000, 'maxEvents');
    const interval = number(args.intervalMs, 500, 100, 5000, 'intervalMs');
    const { follow, durationMs, maxEvents: ignored, intervalMs, ...filters } = args;
    const started = now();
    let reason = 'duration';
    while (!signal?.aborted && (!duration || now() - started < duration)) {
      const result = await request({ ...filters, channel: command, ...(currentCursor ? { cursor: currentCursor } : {}) },
        { signal, profile, connectionId, timeoutMs: duration ? Math.min(20000, Math.max(1, duration - (now() - started))) : 20000 });
      if (signal?.aborted) break;
      if (!result.ok) {
        if (ready && result.error?.code === 'TIMEOUT' && duration && now() - started >= duration) break;
        throw failure(result.error?.code || 'BROWSER_OPERATION_FAILED', result.error?.message || 'Browser event poll failed.');
      }
      if (result.contextId) {
        if (ready && result.contextId !== profile) throw failure('PROFILE_CHANGED', 'Browser profile changed during observation.');
        profile = result.contextId; envelope.contextId = profile;
        connectionId ||= result.connectionId;
      }
      const batch = result.data;
      if (batch?.observationVersion !== 1 || !Array.isArray(batch.entries) || typeof batch.startCursor !== 'string' || typeof batch.nextCursor !== 'string') throw failure('EXTENSION_UPGRADE_REQUIRED', 'Reload the extension to stream browser events.');
      if (!ready) {
        currentCursor = batch.startCursor; ready = true;
        await emit({ ...envelope, ok: true, event: 'ready', cursor: currentCursor, truncated: batch.truncated, capturedAt: batch.capturedAt });
      }
      for (const entry of batch.entries) {
        if (signal?.aborted) break;
        if (entry.phase === 'gap') throw failure('OBSERVATION_GAP', 'Network pending-request capacity was exceeded. Start a new observation explicitly.');
        if (typeof entry.eventCursor !== 'string') throw failure('INVALID_STREAM_RESPONSE', 'Event cursor missing; cannot resume safely.');
        await emit({ ...envelope, ok: true, event: 'entry', cursor: entry.eventCursor, data: entry });
        currentCursor = entry.eventCursor; count++;
        if (maxEvents && count >= maxEvents) { reason = 'max_events'; break; }
      }
      if (signal?.aborted || (maxEvents && count >= maxEvents)) break;
      if (currentCursor !== batch.nextCursor) {
        await emit({ ...envelope, ok: true, event: 'checkpoint', cursor: batch.nextCursor });
        currentCursor = batch.nextCursor;
      }
      if (!batch.hasMore) {
        const remaining = duration ? duration - (now() - started) : interval;
        if (remaining <= 0) break;
        try { await sleep(Math.min(interval, remaining), signal); }
        catch (error) { if (!signal?.aborted) throw error; }
      }
    }
    if (signal?.aborted) reason = String(signal.reason || 'aborted');
    await emit({ ...envelope, ok: true, event: 'end', reason, cursor: currentCursor ?? null, entries: count });
    return reason === 'SIGINT' ? 130 : reason === 'SIGTERM' ? 143 : 0;
  } catch (error) {
    if (signal?.reason === 'output_closed' || error.code === 'EPIPE') return 0;
    try {
      await emit({ ...envelope, ok: false, event: 'error', cursor: currentCursor ?? null, entries: count,
        error: { code: error.code || 'STREAM_FAILED', message: error.code ? error.message : 'Browser observation stopped unexpectedly.' } });
    } catch (outputError) { if (outputError.code === 'EPIPE') return 0; }
    return 1;
  }
}

export async function runBrowserFollow(command, args, { profile } = {}) {
  const controller = new AbortController();
  const stopInterrupt = () => controller.abort('SIGINT'), stopTerminate = () => controller.abort('SIGTERM');
  const outputError = error => controller.abort(error.code === 'EPIPE' ? 'output_closed' : 'output_error');
  process.on('SIGINT', stopInterrupt); process.on('SIGTERM', stopTerminate); process.stdout.on('error', outputError);
  const emit = value => new Promise((resolve, reject) => {
    if (controller.signal.reason === 'output_closed') { resolve(); return; }
    process.stdout.write(JSON.stringify(value) + '\n', error => {
      if (error) { outputError(error); reject(error); } else resolve();
    });
  });
  try { return await followBrowser(command, args, { emit, signal: controller.signal, profile }); }
  finally {
    // Node emits the stream error after the write callback; keep its handler
    // until that turn has completed even when the callback already rejected.
    await new Promise(resolve => setImmediate(resolve));
    process.off('SIGINT', stopInterrupt); process.off('SIGTERM', stopTerminate); process.stdout.off('error', outputError);
  }
}
