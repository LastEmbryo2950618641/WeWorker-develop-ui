import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb, insertVisit, queryVisits } from '../db.js';
import { handle } from '../handler.js';

test('visits aggregates PV and distinct visitors across days and excludes old records', t => {
  const db = openDb(':memory:');
  t.after(() => db.close());
  const now = Date.now();
  insertVisit(db, { ip: 'fixture-a', ts: now });
  insertVisit(db, { ip: 'fixture-a', ts: now });
  insertVisit(db, { ip: 'fixture-b', ts: now - 86400000 });
  insertVisit(db, { ip: 'fixture-old', ts: now - 40 * 86400000 });
  const result = queryVisits(db, { since: '7d' });
  assert.equal(result.totalPv, 3);
  assert.equal(result.totalUv, 2);
  assert.equal(result.rows.length, 2);
});

test('visits HTTP routes authenticate writes and reads and reject malformed JSON', async t => {
  const db = openDb(':memory:');
  const server = createServer((req, res) => handle(req, res, { db, token: 'fixture-token' }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/v1/visits`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
  const headers = { authorization: 'Bearer fixture-token', 'content-type': 'application/json' };
  assert.equal((await fetch(url, { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ path: '/docs' }) })).status, 200);
  const result = await (await fetch(url, { headers })).json();
  assert.equal(result.totalPv, 1);
  assert.equal(result.totalUv, 1);
});
