import test from 'node:test';
import assert from 'node:assert/strict';
import { beginBrowserEvents, clearBrowserEvents, recordBrowserEvent, readBrowserEvents, readNetworkEventDetail, browserTimeWindow } from '../background/browser-events.js';
import { executeBrowserCommand } from '../background/browser-commands.js';
const fresh = () => { clearBrowserEvents(7); clearBrowserEvents(8); beginBrowserEvents(7); beginBrowserEvents(8); };
const event = (method, params, sessionId, tabId = 7) => recordBrowserEvent(tabId, { tabId, ...(sessionId ? { sessionId } : {}) }, method, params);
const log = text => event('Runtime.consoleAPICalled', { type: 'log', args: [{ value: text }] });
const start = (id, session, url = 'https://example.com/query?token=placeholder-secret') => event('Network.requestWillBeSent', { requestId: id, request: { url, method: 'POST', postData: '{"value":"Example","token":"placeholder-secret"}' }, type: 'Fetch' }, session);
const complete = (id, session, status = 200) => { event('Network.responseReceived', { requestId: id, response: { status, mimeType: 'application/json' } }, session); event('Network.loadingFinished', { requestId: id, encodedDataLength: 40 }, session); };

test('sequence cursors preserve identical timestamps, paginate without duplicates and exclude other tabs/channels', t => {
  fresh(); t.mock.method(Date, 'now', () => 10000); log('Example one'); log('Example two'); log('Example three');
  const first = readBrowserEvents(7, { channel: 'console', limit: 2 }); assert.equal(first.entries.length, 2); assert.equal(first.hasMore, true);
  const second = readBrowserEvents(7, { channel: 'console', cursor: first.nextCursor }); assert.deepEqual(second.entries.map(x => x.text), ['Example three']);
  assert.equal(readBrowserEvents(7, { channel: 'console', cursor: second.nextCursor }).entries.length, 0);
  assert.throws(() => readBrowserEvents(8, { channel: 'console', cursor: first.nextCursor }), { code: 'OBSERVATION_CURSOR_EXPIRED' });
  assert.throws(() => readBrowserEvents(7, { channel: 'network', cursor: first.nextCursor }), { code: 'OBSERVATION_CURSOR_EXPIRED' });
});

test('rolling until holds young events until eligible; filter checkpoints and loss are explicit', t => {
  fresh(); let now = 10000; t.mock.method(Date, 'now', () => now);
  const baseline = readBrowserEvents(7, { channel: 'console' }).nextCursor; log('Example early'); now = 12000; log('Example young');
  const old = readBrowserEvents(7, { channel: 'console', cursor: baseline, until: '1s', since: '1m' });
  assert.equal(old.entries.length, 1); assert.equal(old.deferred, true);
  now = 14000; assert.equal(readBrowserEvents(7, { channel: 'console', cursor: old.nextCursor, until: '1s' }).entries.length, 1);
  const empty = readBrowserEvents(7, { channel: 'console', match: 'absent' }); assert.equal(empty.entries.length, 0); assert.notEqual(empty.nextCursor, baseline);
  for (let i = 0; i < 201; i++) log('Example ' + i);
  assert.throws(() => readBrowserEvents(7, { channel: 'console', cursor: empty.nextCursor }), { code: 'OBSERVATION_CURSOR_EXPIRED' });
  assert.equal(readBrowserEvents(7, { channel: 'console' }).truncated, true);
  clearBrowserEvents(7); assert.throws(() => readBrowserEvents(7, { channel: 'console' }), { code: 'OBSERVATION_CONTEXT_EXPIRED' });
  beginBrowserEvents(7); assert.throws(() => readBrowserEvents(7, { channel: 'console', cursor: old.nextCursor }), { code: 'OBSERVATION_CURSOR_EXPIRED' });
});

test('same request IDs in root/child retain independent metadata, details and credential redaction', async () => {
  fresh(); start('same'); start('same', 'example-child'); complete('same'); complete('same', 'example-child', 503);
  const batch = readBrowserEvents(7, { channel: 'network' }); assert.equal(batch.entries.length, 2);
  assert.notEqual(batch.entries[0].key, batch.entries[1].key); assert.equal(batch.entries[1].source, 'child-frame');
  assert.equal(JSON.stringify(batch).includes('placeholder-secret'), false); assert.equal(batch.entries[0].request, undefined);
  const calls = [], chrome = { debugger: { sendCommand: async (...args) => { calls.push(args); return { body: '{"value":"Example","access_token":"placeholder-secret"}' }; } } };
  const detail = await readNetworkEventDetail(chrome, 7, batch.entries[1].key);
  assert.equal(calls[0][0].sessionId, 'example-child'); assert.equal(detail.entry.response.value, 'Example');
  assert.equal(JSON.stringify(detail).includes('placeholder-secret'), false);
  assert.equal(readBrowserEvents(7, { channel: 'network', failed: true }).entries.length, 1);
  assert.equal(readBrowserEvents(7, { channel: 'network', match: 'absent' }).entries.length, 0);
});

test('redirects never read a successor body; network failures, descendant detach and capacity gaps remain visible', async () => {
  fresh(); start('redirect'); event('Network.requestWillBeSent', { requestId: 'redirect', redirectResponse: { status: 302 }, request: { url: 'https://example.com/result' }, type: 'Fetch' }); complete('redirect');
  const rows = readBrowserEvents(7, { channel: 'network' }).entries; assert.deepEqual(rows.map(x => x.phase), ['redirect', 'complete']);
  const chrome = { debugger: { sendCommand: () => { throw Error('must not read a redirect body'); } } };
  assert.equal((await readNetworkEventDetail(chrome, 7, rows[0].key)).entry.response.omitted, true);
  start('failure'); event('Network.loadingFailed', { requestId: 'failure', errorText: 'Example network error' });
  event('Target.attachedToTarget', { sessionId: 'example-parent' });event('Target.attachedToTarget', { sessionId: 'example-inner' }, 'example-parent');
  start('pending', 'example-inner');event('Target.detachedFromTarget', { sessionId: 'example-parent' });
  assert.equal(readBrowserEvents(7, { channel: 'network', failed: true }).entries.length, 2);
  for (let i = 0; i < 1001; i++) start('pending-' + i);
  assert.ok(readBrowserEvents(7, { channel: 'network', match: 'absent' }).entries.some(x => x.phase === 'gap'));
});

test('duration/filter validation and non-HTTP URL omission are explicit', () => {
  fresh(); assert.deepEqual(browserTimeWindow({ since: '2m', until: '500ms' }, 200000), { lower: 80000, upper: 199500 });
  for (const since of ['-1s', 'oops', '25h', true]) assert.throws(() => browserTimeWindow({ since }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => browserTimeWindow({ since: '1s', until: '2s' }), { code: 'INVALID_ARGUMENT' });
  for (const args of [{ channel: 'other' }, { channel: 'network', level: 'log' }, { channel: 'network', failed: 'yes' }, { channel: 'console', all: true }, { channel: 'console', limit: 201 }]) assert.throws(() => readBrowserEvents(7, args), { code: 'INVALID_ARGUMENT' });
  start('data', undefined, 'data:text/plain,example-private-body'); complete('data');assert.equal(readBrowserEvents(7, { channel: 'network' }).entries[0].url, '');
});

test('request reuse while an asynchronous body read is pending cannot return the successor body', async () => {
  fresh(); start('same'); complete('same');
  const key = readBrowserEvents(7, {channel:'network'}).entries[0].key;
  const chrome = {debugger:{sendCommand:async()=>{ start('same'); return {body:'{"value":"Example successor"}'}; }}};
  assert.equal((await readNetworkEventDetail(chrome,7,key)).entry.response.omitted,true);
  // A pending-capacity eviction must not make the old ID valid again.
  for(let i=0;i<1000;i++) start('example-pending-'+i);
  chrome.debugger.sendCommand=()=>{throw new Error('Reused ID must remain unreadable');};
  assert.equal((await readNetworkEventDetail(chrome,7,key)).entry.response.omitted,true);
});

test('polling detects explicit debugger detach without silently reattaching or returning stale history', async () => {
  fresh(); log('Example previous observation'); let detached = false;
  const chrome = {storage:{session:{get:async()=>({'webcli-browser-tab-7':'example-identity'})}},tabs:{get:async()=>({url:'https://example.com/'})},
    debugger:{sendCommand:async()=>{throw new Error('Debugger detached');}}};
  const result = await executeBrowserCommand({command:'events',tabId:7,identity:'example-identity',args:{channel:'console'}},
    {chrome,onBrowserDetach:()=>{detached=true;},ensureCdpAttached:()=>{throw new Error('Must not reattach');}});
  assert.equal(result.error.code,'OBSERVATION_CONTEXT_EXPIRED');assert.equal(detached,true);
  assert.throws(()=>readBrowserEvents(7,{channel:'console'}),{code:'OBSERVATION_CONTEXT_EXPIRED'});
});
