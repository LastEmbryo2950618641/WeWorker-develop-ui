import test from 'node:test';
import assert from 'node:assert/strict';
import { beginBrowserDownloads, clearBrowserDownloads, markBrowserDownloadAction, recordBrowserDownload, readBrowserDownloads, waitBrowserDownload } from '../background/browser-downloads.js';
const begin = (tab, id, name = 'example.txt', url = 'https://example.com/example.txt?token=placeholder-secret') => recordBrowserDownload(tab, 'Page.downloadWillBegin', { guid: id, suggestedFilename: name, url });
const progress = (tab, id, state = 'completed') => recordBrowserDownload(tab, 'Page.downloadProgress', { guid: id, state, receivedBytes: 12, totalBytes: 12 });
function fresh() { for (const id of [7, 8]) { clearBrowserDownloads(id); beginBrowserDownloads(id); } }

test('cursor excludes old downloads; completion belongs to the selected tab and redacts URL credentials', async () => {
  fresh(); begin(7, 'example-old'); progress(7, 'example-old');
  const { cursor: after } = readBrowserDownloads(7, {});
  begin(8, 'example-other-tab'); progress(8, 'example-other-tab');
  await assert.rejects(waitBrowserDownload({}, 7, { after, timeoutMs: 0 }), error => error.code === 'DOWNLOAD_TIMEOUT' && error.details.state === 'not_seen');
  begin(7, 'example-new'); progress(7, 'example-new');
  const result = await waitBrowserDownload({}, 7, { after, value: 'example.txt', timeoutMs: 0 });
  assert.equal(result.downloadId, 'example-new'); assert.equal(result.downloaded, true); assert.equal(result.receivedBytes, 12);
  assert.ok(!JSON.stringify(result).includes('placeholder-secret')); assert.equal(result.fileResolved, false);
});

test('a pending observer retains its boundary when the triggering action starts', async () => {
  fresh(); begin(7, 'example-before'); progress(7, 'example-before'); markBrowserDownloadAction(7);
  const pending = waitBrowserDownload({}, 7, { timeoutMs: 1000 });
  begin(7, 'example-current'); markBrowserDownloadAction(7); progress(7, 'example-current');
  assert.equal((await pending).downloadId, 'example-current');
});

test('default waits use the latest action boundary while explicit IDs can inspect an earlier transfer', async () => {
  fresh(); begin(7, 'example-previous'); progress(7, 'example-previous'); markBrowserDownloadAction(7);
  await assert.rejects(waitBrowserDownload({}, 7, { timeoutMs: 0 }), { code: 'DOWNLOAD_TIMEOUT' });
  assert.equal((await waitBrowserDownload({}, 7, { downloadId: 'example-previous', timeoutMs: 0 })).downloaded, true);
});

test('timeouts preserve progress and IDs, interruption is an error, and concurrent matches require selection', async () => {
  fresh(); begin(7, 'example-pending');
  await assert.rejects(waitBrowserDownload({}, 7, { timeoutMs: 0 }), error => error.code === 'DOWNLOAD_TIMEOUT' && error.details.download.downloadId === 'example-pending' && error.details.state === 'in_progress');
  progress(7, 'example-pending', 'canceled');
  await assert.rejects(waitBrowserDownload({}, 7, { timeoutMs: 0 }), error => error.code === 'DOWNLOAD_INTERRUPTED' && error.details.download.state === 'interrupted');
  begin(7, 'example-second'); progress(7, 'example-second');
  await assert.rejects(waitBrowserDownload({}, 7, { timeoutMs: 0 }), error => error.code === 'DOWNLOAD_AMBIGUOUS' && error.details.matches.length === 2);
  assert.equal((await waitBrowserDownload({}, 7, { downloadId: 'example-second', timeoutMs: 0 })).downloaded, true);
});

test('closed/rebound observations and evicted cursors cannot silently select another download', async () => {
  fresh(); const { cursor: after } = readBrowserDownloads(7, {});
  for (let i = 0; i < 101; i++) begin(7, 'example-' + i);
  assert.equal(readBrowserDownloads(7, { limit: 100 }).downloads.length, 100);
  await assert.rejects(waitBrowserDownload({}, 7, { after, timeoutMs: 0 }), { code: 'DOWNLOAD_CURSOR_EXPIRED' });
  const pending = waitBrowserDownload({}, 7, { after: readBrowserDownloads(7, {}).cursor, timeoutMs: 1000 });
  clearBrowserDownloads(7); beginBrowserDownloads(7);
  await assert.rejects(pending, { code: 'DOWNLOAD_CONTEXT_EXPIRED' });
  assert.throws(() => readBrowserDownloads(7, { after }), { code: 'DOWNLOAD_CURSOR_EXPIRED' });
});

test('file enrichment searches only the observed URL and narrow time window, never guesses among duplicates', async () => {
  fresh(); begin(7, 'example-file'); progress(7, 'example-file');
  const searches = []; let duplicates = false;
  const chrome = { downloads: { search: async query => { searches.push(query); return [{ id: 10, filename: '/tmp/example-download.txt', mime: 'text/plain', state: 'complete', exists: true }, ...(duplicates ? [{ id: 11, filename: '/tmp/example-other.txt' }] : [])]; } } };
  const result = await waitBrowserDownload(chrome, 7, { downloadId: 'example-file', timeoutMs: 0 });
  assert.equal(result.filename, '/tmp/example-download.txt'); assert.equal(result.chromeDownloadId, 10);
  assert.ok(searches.every(query => query.startedAfter && query.startedBefore && (query.urlRegex || query.finalUrlRegex)));
  duplicates = true;
  const uncertain = await waitBrowserDownload(chrome, 7, { downloadId: 'example-file', timeoutMs: 0 });
  assert.equal(uncertain.downloaded, true); assert.equal(uncertain.fileResolved, false); assert.equal(uncertain.fileResolution, 'ambiguous'); assert.equal(uncertain.filename, undefined);
});

test('data URLs do not expose file bodies, invalid selectors fail, and late progress cannot revive a terminal record', async () => {
  fresh(); begin(7, 'example-data', 'example.txt', 'data:text/plain,example-private-body'); progress(7, 'example-data'); progress(7, 'example-data', 'canceled');
  const item = readBrowserDownloads(7, {}).downloads[0]; assert.equal(item.url, ''); assert.equal(item.urlOmitted, true); assert.equal(item.state, 'complete');
  assert.throws(() => readBrowserDownloads(7, { limit: 101 }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(waitBrowserDownload({}, 7, { downloadId: 'example-data', after: 'example-cursor' }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(waitBrowserDownload({}, 7, { timeoutMs: 31000 }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(waitBrowserDownload({}, 7, { frameId: 0 }), { code: 'INVALID_ARGUMENT' });
});
