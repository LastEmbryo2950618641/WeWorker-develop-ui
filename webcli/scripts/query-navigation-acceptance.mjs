import assert from 'node:assert/strict';
import http from 'node:http';

export async function verifyQueryNavigation({ cli, record, passed }) {
  const requests = [], sessions = [];
  let drift = false;
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/lookup' || url.pathname.startsWith('/groups/')) {
      const q = url.searchParams.get('q'), category = url.searchParams.get('category');
      requests.push({ pathname: url.pathname, q, category });
      if (q === 'redirect-example') { url.searchParams.set('q', 'wrong-example'); res.writeHead(302, { location: url.pathname + url.search }); res.end(); return; }
      const group = url.pathname.startsWith('/groups/') ? decodeURIComponent(url.pathname.slice(8)) : '';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(`<!doctype html><title>Public query fixture</title><article class="${drift ? 'changed-query' : 'query-row'}"><h3>${escape(q || '')}</h3><p>${escape(category || '')}</p><b>${escape(group)}</b></article>`); return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end('<!doctype html><title>Public query entry</title><h1>Entry</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  async function settle(taskId) {
    for (let i = 0; i < 100; i++) {
      const state = (await cli('exploration.get', { taskId })).data;
      if (!['collecting', 'validating', 'installing'].includes(state.status)) return state;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Query navigation did not settle');
  }
  const result = { strategy: 'UI_SELECTOR', selector: '.query-row', fields: { title: { selector: 'h3' }, category: { selector: 'p' } } };
  const queryParameters = [{ name: 'category', queryKey: 'category', description: 'Public category' }, { name: 'keyword', queryKey: 'q', description: 'Public search term' }];
  const base = { mode: 'navigate', resultPathname: '/lookup', queryParameters, result, timeoutMs: 3000 };
  try {
    for (const kind of ['query', 'mixed', 'workflow']) {
      const mixed = kind === 'mixed';
      const session = 'example-url-' + kind; sessions.push(session);
      const tabId = (await cli('browser.open', { session, url: origin + '/entry' })).data.tabId;
      const taskId = (await cli('exploration.start', { tabId, goal: 'Read public URL query navigation', requestId: 'example-url-' + kind })).data.taskId;
      assert.equal((await settle(taskId)).status, 'evidence_ready');
      const source = mixed ? { ...base, resultPathname: '/groups/:id', pathParameters: [{ segmentIndex: 1, name: 'groupId', description: 'Public group ID' }], result: { ...result, fields: { ...result.fields, group: { selector: 'b' } } } }
        : kind === 'workflow' ? { mode: 'workflow', timeoutMs: 10000, steps: [
          { pathname: '/entry', query: { mode: 'navigate', resultPathname: '/entry', result: { strategy: 'UI_SELECTOR', selector: 'h1', fields: { title: {} } } } },
          { pathname: '/entry', query: base },
        ] } : base;
      const values = { keyword: 'example-unretained-query', category: 'example-unretained-category', ...(mixed ? { groupId: 'example-public-group' } : {}) };
      const observe = async (id, querySource, args) => { await cli('exploration.query', { taskId: id, source: querySource, values: args, reason: 'Read an explicit same-origin public query route' }); assert.equal((await settle(id)).status, 'evidence_ready'); return (await cli('exploration.evidence', { taskId: id })).data; };
      const evidence = await observe(taskId, source, values); assert.ok(!JSON.stringify(evidence).includes('example-unretained'));
      const plan = { tools: [{ name: 'read-url-' + kind, risk: 'read', strategy: 'UI_SELECTOR', sourcePageId: evidence.pageSources[0].id, readReason: 'Public read-only query document' }] };
      const tool = (await cli('exploration.generate', { taskId, plan })).data.toolNames[0];
      const cases = ['007', '示例 & +?#%/'].map((keyword, i) => ({ id: 'query-' + i, args: { keyword, category: ['books', 'music'][i], ...(mixed ? { groupId: ['007', '示例'][i] } : {}) }, expect: { equals: { 'data.items.0.title': keyword, 'data.items.0.category': ['books', 'music'][i], ...(mixed ? { 'data.items.0.group': ['007', '示例'][i] } : {}) }, rowCount: { path: 'data.items', min: 1, max: 1 } } }));
      const writeCases = async entries => { const before = (await cli('exploration.verification-read', { taskId, tool })).data; await cli('exploration.verification-write', { taskId, tool, expectedHash: before.hash, cases: entries }); };
      await writeCases(cases.map(item => ({ ...item, args: { ...item.args, category: 'books' } })));
      const beforeMissing = requests.length;
      assert.equal((await cli('exploration.validate', { taskId }, false)).error.code, 'VERIFICATION_REQUIRED'); assert.equal(requests.length, beforeMissing);
      await writeCases(cases); await cli('exploration.validate', { taskId });
      const validated = await settle(taskId); assert.equal(validated.status, 'review_ready', JSON.stringify(validated));
      const review = (await cli('exploration.review', { taskId })).data;
      assert.ok(review.permissions.some(value => /page-(navigation|workflow):/.test(value) && value.includes('queryParameters')));
      await cli('exploration.install', { taskId, reviewId: review.reviewId, confirmed: true }); assert.equal((await settle(taskId)).status, 'installed');
      for (const keyword of ['009', '示例 & +?#%/', '示例 & +?#%/']) {
        const before = requests.length, actual = await cli(tool, { keyword, category: 'music', ...(mixed ? { groupId: '009' } : {}) });
        assert.equal(actual.data.items[0].title, keyword); assert.equal(actual.data.items[0].category, 'music');
        if (mixed) assert.equal(actual.data.items[0].group, '009');
        assert.equal(requests.length, before + 1);
        assert.deepEqual(requests.at(-1), { pathname: mixed ? '/groups/009' : '/lookup', q: keyword, category: 'music' });
      }
      const beforeInvalid = requests.length;
      const invalid = await cli(tool, { keyword: 7, category: 'music', ...(mixed ? { groupId: '009' } : {}) }, false);
      if (kind === 'workflow') { assert.equal(invalid.ok, false); assert.equal(invalid.error.code, 'INVALID_PAGE_QUERY_ARGUMENT'); }
      assert.match(typeof invalid.error === 'string' ? invalid.error : invalid.error.message, /string|query|parameter/i); assert.equal(requests.length, beforeInvalid);
      const redirected = await cli(tool, { keyword: 'redirect-example', category: 'music', ...(mixed ? { groupId: '009' } : {}) }, false);
      assert.equal(redirected.ok, false); assert.equal(redirected.error.code, 'PAGE_QUERY_ROUTE_CHANGED');
      assert.equal(requests.slice(beforeInvalid).filter(item => item.q === 'redirect-example').length, 1);
      assert.equal((await cli(tool, { keyword: '010', category: 'music', ...(mixed ? { groupId: '010' } : {}) })).data.items[0].title, '010');
      const known = (await cli('exploration.knowledge-read', { site: review.name })).data;
      await cli('exploration.knowledge-save', { taskId, expectedHash: known.hash });
      const saved = (await cli('exploration.knowledge-read', { site: review.name })).data;
      assert.ok(JSON.stringify(saved).includes('queryParameters')); assert.ok(!JSON.stringify(saved).includes('example-unretained'));
      await record('query-navigation-' + kind, validated);
      passed('public URL ' + kind + ': two independently varying queries, exact literal values, fresh document, install/call/knowledge, query-only redirect rejection and no replay');
      if (kind === 'query') {
        drift = true;
        const repairId = (await cli('exploration.start', { tabId, goal: 'Repair public query markup', requestId: 'example-query-repair' })).data.taskId; await settle(repairId);
        const fresh = await observe(repairId, { ...base, result: { ...result, selector: '.changed-query' } }, { keyword: '011', category: 'books' });
        const info = (await cli('exploration.repair-info', { site: review.name })).data;
        await cli('exploration.repair', { taskId: repairId, site: review.name, expectedDigest: info.digest, plan: { tools: [{ ...plan.tools[0], sourcePageId: fresh.pageSources[0].id }] } });
        await cli('exploration.validate', { taskId: repairId }); assert.equal((await settle(repairId)).status, 'draft');
        const file = 'extension/commands/read-url-query.js', old = (await cli('exploration.draft-read', { taskId: repairId, file })).data;
        await cli('exploration.draft-write', { taskId: repairId, file, expectedHash: old.hash, content: old.content.replaceAll('.query-row', '.changed-query') });
        await cli('exploration.validate', { taskId: repairId }); assert.equal((await settle(repairId)).status, 'review_ready');
        const repairReview = (await cli('exploration.review', { taskId: repairId })).data;
        await cli('exploration.install', { taskId: repairId, reviewId: repairReview.reviewId, confirmed: true }); assert.equal((await settle(repairId)).status, 'installed');
        assert.equal((await cli(tool, { keyword: '012', category: 'books' })).data.items[0].title, '012');
        passed('query navigation repair: retained failing cases, fixed extraction, preserved query permissions, revalidated and installed');
        drift = false;
      }
    }
  } finally {
    for (const session of sessions) await cli('browser.close', { session }).catch(() => {});
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}
