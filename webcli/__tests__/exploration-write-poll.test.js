import { afterEach, expect, it, vi } from 'vitest';
import { normalizeWritePoll, readWriteEffect } from '../exploration-write-poll.js';
import { strictVerifier } from '../http-preview.js';

afterEach(() => vi.useRealTimers());
const poll = { intervalMs: 250, maxAttempts: 3, pending: { equals: { state: 'pending' } }, resultPending: { equals: { state: 'pending' } } };
const effect = { readback: { url: 'https://example.com/summary' }, before: { equals: { state: 'idle', id: 'example' } },
  after: { equals: { state: 'ready', title: 'After', id: 'example' } },
  resultReadback: { identityPath: 'id', expect: { equals: { state: 'ready', title: 'After' } } }, poll };
const pending = { state: 'pending', id: 'example' }, ready = { state: 'ready', title: 'After', id: 'example' };
async function fixture(values, extra = {}) {
  const verify = await strictVerifier();
  vi.useFakeTimers();
  const controller = new AbortController();
  const read = vi.fn(async () => ({ value: values.shift(), document: { loaderId: 'example' } }));
  const args = { execution: { effect }, phase: 'after', read, verify, signal: controller.signal, deadline: Date.now() + 30000, ...extra };
  return { controller, read, args };
}

it.each([
  { intervalMs: 249 }, { intervalMs: 5001 }, { intervalMs: '250' }, { intervalMs: 250.5 },
  { maxAttempts: 1 }, { maxAttempts: 21 }, { maxAttempts: Infinity }, { extra: true },
  { pending: undefined, resultPending: undefined }, { pending: { equals: { state: 'ready' } } },
  { pending: { equals: { missing: 'pending' } } }, { pending: { equals: { '$.state': 'pending' } } },
  { pending: { equals: { state: {} } } }, { pending: { equals: { state: 'pending', access_token: 'example' } } },
])('rejects ambiguous or unbounded poll contracts %#', patch => {
  expect(() => normalizeWritePoll({ ...poll, ...patch }, effect)).toThrow();
});

it('requires a result contract for result pending and respects canonical final aliases', () => {
  expect(() => normalizeWritePoll(poll, { after: effect.after })).toThrow();
  expect(normalizeWritePoll({ intervalMs: 250, maxAttempts: 2, pending: poll.pending }, { after: { equals: { '$.state': 'ready' } } }).pending).toEqual(poll.pending);
});

it('polls explicit pending states, rechecks fixed effects and freezes the first document across rounds', async () => {
  const f = await fixture([pending, ready, { id: 0, state: 'pending' }, ready, { id: 0, state: 'ready', title: 'After' }], { binding: { id: 0, url: 'https://example.com/records/0' } });
  const task = readWriteEffect(f.args);
  await vi.runAllTimersAsync();
  expect(await task).toMatchObject({ passed: true, attempts: 3 });
  expect(f.read.mock.calls.map(([request]) => request.url)).toEqual([effect.readback.url, effect.readback.url, 'https://example.com/records/0', effect.readback.url, 'https://example.com/records/0']);
  expect(f.read.mock.calls.slice(1).every(([, document]) => document.loaderId === 'example')).toBe(true);
});

it.each([['exhausted', [pending, pending, pending], 3], ['unlisted state', [{ state: 'failed' }], 1], ['wrong content in final state', [{ ...ready, title: 'Different' }], 1]])('stops without success for %s', async (_name, values, attempts) => {
  const f = await fixture(values), task = readWriteEffect(f.args);
  await vi.runAllTimersAsync();
  expect(await task).toMatchObject({ passed: false, attempts });
  expect(f.read).toHaveBeenCalledTimes(attempts);
});

it('never retries a resource identity mismatch even when its state is pending', async () => {
  const f = await fixture([ready, { id: '0', state: 'pending' }], { binding: { id: 0, url: 'https://example.com/records/0' } });
  expect(await readWriteEffect(f.args)).toMatchObject({ passed: false, attempts: 1 });
  expect(f.read).toHaveBeenCalledTimes(2);
});

it('never polls away UI stable resource identity mismatch', async () => {
  const f = await fixture([{ state: 'pending', id: 'different' }], { execution: { page: { ui: {} }, effect: { ...effect, identityPath: 'id' } } });
  expect(await readWriteEffect(f.args)).toMatchObject({ passed: false, attempts: 1 });
  expect(f.read).toHaveBeenCalledTimes(1);
});

it('does not poll preconditions or legacy one-shot after checks', async () => {
  for (const extra of [{ phase: 'before' }, { execution: { effect: { ...effect, poll: undefined } } }]) {
    const f = await fixture([pending], extra);
    expect(await readWriteEffect(f.args)).toMatchObject({ passed: false, attempts: 1 });
    expect(f.read).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  }
});

it('cancels during a poll delay and starts no later read', async () => {
  const f = await fixture([pending]), task = readWriteEffect(f.args);
  const rejected = expect(task).rejects.toMatchObject({ code: 'WRITE_READBACK_CANCELLED' });
  await vi.advanceTimersByTimeAsync(100); f.controller.abort(); await rejected;
  await vi.runAllTimersAsync(); expect(f.read).toHaveBeenCalledTimes(1);
});

it('shares a total deadline across attempts and rejects a late successful response', async () => {
  const f = await fixture([pending]); f.args.deadline = Date.now() + 100;
  const task = readWriteEffect(f.args), rejected = expect(task).rejects.toMatchObject({ code: 'WRITE_READBACK_TIMEOUT' });
  await vi.runAllTimersAsync(); await rejected; expect(f.read).toHaveBeenCalledTimes(1);
  f.read.mockImplementation(async () => { vi.setSystemTime(f.args.deadline + 1); return { value: ready }; });
  f.args.deadline = Date.now() + 100;
  await expect(readWriteEffect(f.args)).rejects.toMatchObject({ code: 'WRITE_READBACK_TIMEOUT' });
});

it.each(['HTTP_STATUS', 'PAGE_WRITE_DOCUMENT_CHANGED', 'PROFILE_DISCONNECTED'])('does not retry transport or document error %s', async code => {
  const f = await fixture([]); f.read.mockRejectedValue(Object.assign(new Error('Example failure'), { code }));
  await expect(readWriteEffect(f.args)).rejects.toMatchObject({ code });
  expect(f.read).toHaveBeenCalledTimes(1);
});
