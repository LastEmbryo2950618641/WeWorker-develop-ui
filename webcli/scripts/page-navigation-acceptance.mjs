import assert from 'node:assert/strict';
import http from 'node:http';

export async function verifyPageNavigation({ cli, record, passed }) {
  const requests = [];
  let drift = false;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/items/')) {
      const id = decodeURIComponent(url.pathname.slice(7)); requests.push(id);
      if (id === 'redirect-example') { res.writeHead(302, { location: '/items/wrong-example' }); res.end(); return; }
      const escaped = id.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(`<!doctype html><title>Example item</title><article class="${drift ? 'changed-row' : 'detail-row'}"><h3>${escaped}</h3></article>`);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Example entries</title><h1>Example entry</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const sessions = [];
  async function settle(taskId) {
    for (let i = 0; i < 90; i++) {
      const state = (await cli('exploration.get', { taskId })).data;
      if (!['collecting', 'validating', 'installing'].includes(state.status)) return state;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Navigation task did not settle');
  }
  try {
    const session = 'example-detail-navigation'; sessions.push(session);
    const tabId = (await cli('browser.open', { session, url: origin + '/entry' })).data.tabId;
    const taskId = (await cli('exploration.start', { tabId, goal: 'Read public item detail pages by identifier', requestId: 'example-navigation' })).data.taskId;
    assert.equal((await settle(taskId)).status, 'evidence_ready');
    const source = { mode: 'navigate', resultPathname: '/items/:id', pathParameters: [{ segmentIndex: 1, name: 'itemId', description: 'Public item identifier' }],
      result: { strategy: 'UI_SELECTOR', selector: '.detail-row', fields: { title: { selector: 'h3' } } }, timeoutMs: 2000 };
    await cli('exploration.query', { taskId, source, values: { itemId: 'example-observation-only' }, reason: 'Read a known public detail route with an explicit identifier' });
    const observed = await settle(taskId); assert.equal(observed.status, 'evidence_ready', JSON.stringify(observed));
    const evidence = (await cli('exploration.evidence', { taskId })).data;
    assert.ok(!JSON.stringify(evidence).includes('example-observation-only'));
    const plan = { tools: [{ name: 'read-detail-navigation', risk: 'read', strategy: 'UI_SELECTOR', sourcePageId: evidence.pageSources[0].id, readReason: 'Read-only item detail document' }] };
    const generated = (await cli('exploration.generate', { taskId, plan })).data, tool = generated.toolNames[0];
    const cases = ['007', '示例'].map((itemId, i) => ({ id: 'item-' + i, args: { itemId }, expect: { equals: { 'data.items.0.title': itemId }, rowCount: { path: 'data.items', min: 1, max: 1 } } }));
    let before = (await cli('exploration.verification-read', { taskId, tool })).data;
    await cli('exploration.verification-write', { taskId, tool, expectedHash: before.hash, cases: cases.slice(0, 1) });
    assert.equal((await cli('exploration.validate', { taskId }, false)).error.code, 'VERIFICATION_REQUIRED');
    before = (await cli('exploration.verification-read', { taskId, tool })).data;
    await cli('exploration.verification-write', { taskId, tool, expectedHash: before.hash, cases });
    await cli('exploration.validate', { taskId });
    const validated = await settle(taskId); assert.equal(validated.status, 'review_ready', JSON.stringify(validated));
    const review = (await cli('exploration.review', { taskId })).data;
    assert.ok(review.permissions.some(value => value.startsWith('page-navigation:')));
    await cli('exploration.install', { taskId, reviewId: review.reviewId, confirmed: true }); assert.equal((await settle(taskId)).status, 'installed');
    for (const itemId of ['008', '009', '009']) {
      const result = await cli(tool, { itemId }); assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.data.items[0].title, itemId);
    }
    assert.deepEqual(requests, ['example-observation-only', '007', '示例', '008', '009', '009']);
    const beforeInvalid = requests.length;
    const invalid = await cli(tool, { itemId: '../007' }, false); assert.match(invalid.error, /path segment/); assert.equal(requests.length, beforeInvalid);
    const redirected = await cli(tool, { itemId: 'redirect-example' }, false); assert.equal(redirected.ok, false); assert.equal(redirected.error.code, 'PAGE_QUERY_ROUTE_CHANGED');
    assert.equal(requests.filter(id => id === 'redirect-example').length, 1);
    assert.equal((await cli(tool, { itemId: '010' })).data.items[0].title, '010');
    const knowledge = (await cli('exploration.knowledge-read', { site: review.name })).data;
    await cli('exploration.knowledge-save', { taskId, expectedHash: knowledge.hash });
    await record('page-navigation-validation', validated);
    passed('dynamic page navigation: actual observation, two varying path cases, installation permissions, leading zeros/Unicode, repeated same URL, redirected identifier failure and no replay');

    drift = true;
    const repairId = (await cli('exploration.start', { tabId, goal: 'Repair changed detail markup', requestId: 'example-navigation-repair' })).data.taskId;
    await settle(repairId);
    await cli('exploration.query', { taskId: repairId, source: { ...source, result: { ...source.result, selector: '.changed-row' } }, values: { itemId: '011' }, reason: 'Read changed detail markup' });
    assert.equal((await settle(repairId)).status, 'evidence_ready');
    const fresh = (await cli('exploration.evidence', { taskId: repairId })).data.pageSources[0];
    const info = (await cli('exploration.repair-info', { site: review.name })).data;
    await cli('exploration.repair', { taskId: repairId, site: review.name, expectedDigest: info.digest, plan: { tools: [{ ...plan.tools[0], sourcePageId: fresh.id }] } });
    await cli('exploration.validate', { taskId: repairId }); assert.equal((await settle(repairId)).status, 'draft');
    const file = 'extension/commands/read-detail-navigation.js';
    const old = (await cli('exploration.draft-read', { taskId: repairId, file })).data;
    await cli('exploration.draft-write', { taskId: repairId, file, expectedHash: old.hash, content: old.content.replaceAll('.detail-row', '.changed-row') });
    await cli('exploration.validate', { taskId: repairId });
    const repaired = await settle(repairId); assert.equal(repaired.status, 'review_ready', JSON.stringify(repaired));
    const repairReview = (await cli('exploration.review', { taskId: repairId })).data;
    await cli('exploration.install', { taskId: repairId, reviewId: repairReview.reviewId, confirmed: true }); await settle(repairId);
    assert.equal((await cli(tool, { itemId: '012' })).data.items[0].title, '012');
    passed('dynamic detail route starts from normalized numeric history and scoped repair imports failing cases, preserves route bindings, revalidates and runs');
  } finally {
    for (const session of sessions) await cli('browser.close', { session }).catch(() => {});
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}
