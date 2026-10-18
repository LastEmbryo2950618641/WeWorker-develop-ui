import assert from 'node:assert/strict';
import http from 'node:http';

export async function verifyHashNavigation({ cli, record, passed, stopBridge, startBridge }) {
  const requests = [], sessions = [], diagnostics = [];
  let documents = 0, revision = 0, drift = false;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('cache-control', 'no-store');
    if (url.pathname === '/data') {
      const id = url.searchParams.get('id'), category = url.searchParams.get('category'), group = url.searchParams.get('group') || '', locale = url.searchParams.get('locale') || '';
      requests.push({ id, category, group, locale });
      diagnostics.push({ kind: 'data', at: Date.now(), id, category, group, locale });
      const data = { item: { id: id === 'wrong-result' ? 'other-result' : id, title: 'Example ' + id }, category, group, locale, revision: id === 'frozen-result' ? 50000 : ++revision };
      setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); }, id === 'slow-result' ? 5000 : 650); return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/hash-app' || url.pathname.startsWith('/hash-app/')) {
      documents++;
      diagnostics.push({ kind: 'document', at: Date.now(), pathname: url.pathname, query: url.search });
      const field = drift ? 'changedResult' : 'publicResult';
      res.end(`<!doctype html><title>Public hash fixture</title><h1>Public hash reader</h1><script>
        window.${field} = { item: { id: 'initial', title: 'Initial' }, category: 'initial', revision: 0 };
        async function read() {
          const fragment = new URL('http://localhost/' + location.hash.slice(1));
          const id = decodeURIComponent(fragment.pathname.split('/')[2] || 'initial'), category = fragment.searchParams.get('category') || 'initial';
          if (id === 'redirect-result') { location.hash = 'items/other?category=' + encodeURIComponent(category); return; }
          const value = await (await fetch('/data?id=' + encodeURIComponent(id) + '&category=' + encodeURIComponent(category) + '&group=' + encodeURIComponent(decodeURIComponent(location.pathname.split('/')[2] || '')) + '&locale=' + encodeURIComponent(new URL(location.href).searchParams.get('lang') || ''))).json();
          if (id !== 'stale-result') window.${field} = value;
        }
        window.addEventListener('hashchange', read); read();
      </script>`); return;
    }
    res.end('<!doctype html><title>Public hash entry</title><h1>Entry</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const settle = async taskId => {
    for (let i = 0; i < 120; i++) {
      const state = (await cli('exploration.get', { taskId })).data;
      if (!['collecting', 'validating', 'installing'].includes(state.status)) return state;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Hash task did not settle');
  };
  const base = { mode: 'navigate', resultPathname: '/hash-app', result: { strategy: 'DOM_STATE', path: ['publicResult'] }, timeoutMs: 3000,
    hashNavigation: { template: 'items/:id', pathParameters: [{ segmentIndex: 1, name: 'itemId', description: 'Public item identifier' }],
      queryParameters: [{ name: 'category', queryKey: 'category', description: 'Public category' }], matchResult: { 'item.id': 'itemId', category: 'category' }, freshnessPath: 'revision', sameTarget: 'reload' } };
  const observe = async (taskId, source, values) => {
    await cli('exploration.query', { taskId, source, values, reason: 'Explicit public hash navigation and fresh business result' });
    const state = await settle(taskId); assert.equal(state.status, 'evidence_ready', JSON.stringify(state));
    return (await cli('exploration.evidence', { taskId })).data;
  };
  try {
    for (const kind of ['single', 'mixed', 'workflow']) {
      const session = 'example-hash-' + kind; sessions.push(session);
      const tabId = (await cli('browser.open', { session, url: origin + '/entry' })).data.tabId;
      const taskId = (await cli('exploration.start', { tabId, goal: 'Read public hash data', requestId: session })).data.taskId;
      assert.equal((await settle(taskId)).status, 'evidence_ready');
      const mixed = kind === 'mixed';
      const extraArgs = mixed ? { groupId: '009', locale: 'zh' } : {};
      const source = kind === 'single' ? base : mixed ? { ...base, resultPathname: '/hash-app/:id', pathParameters: [{ segmentIndex: 1, name: 'groupId', description: 'Public group' }], queryParameters: [{ name: 'locale', queryKey: 'lang', description: 'Public locale' }], hashNavigation: { ...base.hashNavigation, matchResult: { ...base.hashNavigation.matchResult, group: 'groupId', locale: 'locale' } } } : { mode: 'workflow', timeoutMs: 10000, steps: [
        { pathname: '/entry', query: { mode: 'navigate', resultPathname: '/entry', result: { strategy: 'UI_SELECTOR', selector: 'h1', fields: { title: {} } } } },
        { pathname: '/entry', query: base },
      ] };
      const evidence = await observe(taskId, source, { itemId: 'example-unretained-hash', category: 'example-unretained-fragment-query', ...extraArgs });
      assert.ok(!JSON.stringify(evidence).includes('example-unretained'));
      const plan = { tools: [{ name: 'read-hash-' + kind, risk: 'read', strategy: 'UI_SELECTOR', sourcePageId: evidence.pageSources[0].id, readReason: 'Public read-only hash result with explicit reload policy' }] };
      const tool = (await cli('exploration.generate', { taskId, plan })).data.toolNames[0];
      const cases = ['007', '示例'].map((itemId, i) => ({ id: 'hash-' + i, args: { itemId, category: ['books', 'a&+?#%'][i], ...(mixed ? { groupId: ['007', '示例'][i], locale: ['en', 'zh'][i] } : {}) }, expect: { equals: { 'data.item.id': itemId, 'data.item.title': 'Example ' + itemId, 'data.category': ['books', 'a&+?#%'][i], ...(mixed ? { 'data.group': ['007', '示例'][i], 'data.locale': ['en', 'zh'][i] } : {}) }, types: { 'data.revision': 'integer' } } }));
      const writeCases = async entries => { const before = (await cli('exploration.verification-read', { taskId, tool })).data; await cli('exploration.verification-write', { taskId, tool, expectedHash: before.hash, cases: entries }); };
      await writeCases(cases.map(item => ({ ...item, args: { ...item.args, category: 'books' } })));
      const initialRequests = requests.length;
      assert.equal((await cli('exploration.validate', { taskId }, false)).error.code, 'VERIFICATION_REQUIRED'); assert.equal(requests.length, initialRequests);
      await writeCases(cases); await cli('exploration.validate', { taskId });
      const validated = await settle(taskId); assert.equal(validated.status, 'review_ready', JSON.stringify(validated));
      const review = (await cli('exploration.review', { taskId })).data;
      assert.ok(review.permissions.some(value => value.includes('hashNavigation') && value.includes('sameTarget')));
      await cli('exploration.install', { taskId, reviewId: review.reviewId, confirmed: true }); assert.equal((await settle(taskId)).status, 'installed');
      let lastRevision = 0;
      for (const [index, itemId] of ['009', '009', '示例'].entries()) {
        const before = requests.length, docBefore = documents;
        const actual = await cli(tool, { itemId, category: 'a&+?#%', ...extraArgs });
        assert.equal(actual.data.item.id, itemId); assert.equal(actual.data.category, 'a&+?#%');
        if (mixed) { assert.equal(actual.data.group, '009'); assert.equal(actual.data.locale, 'zh'); }
        assert.ok(actual.data.revision > lastRevision); lastRevision = actual.data.revision;
        assert.equal(requests.length, before + 1); assert.deepEqual(requests.at(-1), { id: itemId, category: 'a&+?#%', group: mixed ? '009' : '', locale: mixed ? 'zh' : '' });
        if (kind === 'single') assert.equal(documents, docBefore + (index === 1 ? 1 : 0));
      }
      for (const itemId of ['wrong-result', 'stale-result', 'redirect-result']) {
        const before = requests.length, result = await cli(tool, { itemId, category: 'books', ...extraArgs }, false);
        assert.equal(result.ok, false); assert.ok(['PAGE_QUERY_TIMEOUT', 'PAGE_QUERY_ROUTE_CHANGED'].includes(result.error.code), JSON.stringify(result));
        assert.ok(requests.slice(before).filter(item => item.id === itemId).length <= 1);
        assert.equal((await cli(tool, { itemId: '010', category: 'books', ...extraArgs })).data.item.id, '010');
      }
      if (kind === 'single') {
        assert.equal((await cli(tool, { itemId: 'frozen-result', category: 'books' })).data.revision, 50000);
        const before = requests.length, docBefore = documents;
        const frozen = await cli(tool, { itemId: 'frozen-result', category: 'books' }, false);
        assert.equal(frozen.error.code, 'PAGE_QUERY_TIMEOUT');
        assert.equal(requests.length, before + 1); assert.equal(documents, docBefore + 1);
        assert.equal((await cli(tool, { itemId: '010', category: 'books' })).data.item.id, '010');
      }
      const beforeInvalid = requests.length;
      const invalid = await cli(tool, { itemId: '../invalid', category: 'books', ...extraArgs }, false);
      assert.match(typeof invalid.error === 'string' ? invalid.error : invalid.error?.message || '', /query|parameter|identifier|public/i); assert.equal(requests.length, beforeInvalid);
      const known = (await cli('exploration.knowledge-read', { site: review.name })).data;
      await cli('exploration.knowledge-save', { taskId, expectedHash: known.hash });
      const saved = (await cli('exploration.knowledge-read', { site: review.name })).data;
      assert.ok(JSON.stringify(saved).includes('hashNavigation')); assert.ok(!JSON.stringify(saved).includes('example-unretained'));
      await record('hash-navigation-' + kind, validated);
      passed('hash ' + kind + ': generate/author cases/install/call/knowledge, literal values, fresh correlation, same-target reload and stale/wrong/redirect refusal without replay');
      if (kind === 'single') {
        drift = true;
        const repairId = (await cli('exploration.start', { tabId, goal: 'Repair public hash result field', requestId: 'example-hash-repair' })).data.taskId; await settle(repairId);
        const fresh = await observe(repairId, { ...base, result: { strategy: 'DOM_STATE', path: ['changedResult'] } }, { itemId: '011', category: 'books' });
        const info = (await cli('exploration.repair-info', { site: review.name })).data;
        await cli('exploration.repair', { taskId: repairId, site: review.name, expectedDigest: info.digest, plan: { tools: [{ ...plan.tools[0], sourcePageId: fresh.pageSources[0].id }] } });
        await cli('exploration.validate', { taskId: repairId }); assert.equal((await settle(repairId)).status, 'draft');
        const file = 'extension/commands/read-hash-single.js', old = (await cli('exploration.draft-read', { taskId: repairId, file })).data;
        await cli('exploration.draft-write', { taskId: repairId, file, expectedHash: old.hash, content: old.content.replaceAll('publicResult', 'changedResult') });
        await cli('exploration.validate', { taskId: repairId }); assert.equal((await settle(repairId)).status, 'review_ready');
        const repairReview = (await cli('exploration.review', { taskId: repairId })).data;
        await cli('exploration.install', { taskId: repairId, reviewId: repairReview.reviewId, confirmed: true }); assert.equal((await settle(repairId)).status, 'installed');
        assert.equal((await cli(tool, { itemId: '012', category: 'books' })).data.item.id, '012');
        passed('hash repair: preserved fragment/correlation/reload permissions, retained failing cases and fixed extraction before install');
        drift = false;
      }
    }
    for (const kind of ['cancel', 'restart']) {
      const session = 'example-hash-' + kind; sessions.push(session);
      const tabId = (await cli('browser.open', { session, url: origin + '/entry' })).data.tabId;
      const taskId = (await cli('exploration.start', { tabId, goal: 'Check interrupted hash observation', requestId: session })).data.taskId; await settle(taskId);
      const before = requests.length;
      diagnostics.push({ kind: 'interruption-start', operation: kind, at: Date.now(), before });
      await cli('exploration.query', { taskId, source: { ...base, timeoutMs: 10000 }, values: { itemId: 'slow-result', category: kind }, reason: 'Explicit slow public hash read' });
      for (let i = 0; i < 80 && requests.length === before; i++) await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(requests.length, before + 1, JSON.stringify(requests.slice(before)));
      if (kind === 'cancel') await cli('exploration.cancel', { taskId });
      else { await stopBridge(); await startBridge(); }
      const released = Date.now() + 4000;
      while (true) {
        try { await cli('browser.get', { session, selector: 'h1', property: 'text' }); break; }
        catch (error) { if (Date.now() > released || !error.stdout || JSON.parse(error.stdout).error?.code !== 'TAB_BUSY') throw error; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal((await cli('exploration.get', { taskId })).data.status, kind === 'cancel' ? 'cancelled' : 'interrupted');
      assert.equal(requests.length, before + 1, JSON.stringify(requests.slice(before)));
      assert.equal((await cli('exploration.evidence', { taskId })).data.pageSources.length, 0);
      passed('hash ' + kind + ': stops observation, releases page queue, discards late data and never replays');
    }
    const session = 'example-hash-validation-cancel'; sessions.push(session);
    const tabId = (await cli('browser.open', { session, url: origin + '/entry' })).data.tabId;
    const taskId = (await cli('exploration.start', { tabId, goal: 'Check hash author validation cancellation', requestId: session })).data.taskId; await settle(taskId);
    const slow = { ...base, timeoutMs: 10000 };
    const evidence = await observe(taskId, slow, { itemId: '013', category: 'books' });
    const tool = (await cli('exploration.generate', { taskId, plan: { tools: [{ name: 'read-hash-cancel-validation', risk: 'read', strategy: 'UI_SELECTOR', sourcePageId: evidence.pageSources[0].id, readReason: 'Public read-only cancellation check' }] } })).data.toolNames[0];
    const beforeCases = (await cli('exploration.verification-read', { taskId, tool })).data;
    const cases = ['slow-result', 'never-dispatched'].map((itemId, i) => ({ id: 'cancel-' + i, args: { itemId, category: ['books', 'music'][i] }, expect: { equals: { 'data.item.id': itemId } } }));
    await cli('exploration.verification-write', { taskId, tool, expectedHash: beforeCases.hash, cases });
    const before = requests.length;
    await cli('exploration.validate', { taskId });
    for (let i = 0; i < 80 && requests.length === before; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(requests.length, before + 1);
    await cli('exploration.cancel', { taskId });
    const deadline = Date.now() + 4000;
    while (true) {
      try { await cli('browser.get', { session, selector: 'h1', property: 'text' }); break; }
      catch (error) { if (Date.now() > deadline || !error.stdout || JSON.parse(error.stdout).error?.code !== 'TAB_BUSY') throw error; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal((await cli('exploration.get', { taskId })).data.status, 'cancelled');
    assert.equal(requests.length, before + 1); assert.ok(!requests.some(item => item.id === 'never-dispatched'));
    passed('hash author validation cancellation: one case dispatched, next case never runs and page queue releases');
  } finally {
    await record('hash-request-diagnostics', JSON.parse(JSON.stringify({ requests, diagnostics, documents }, (_, value) => typeof value === 'string' && value.startsWith('example-unretained') ? '[observation omitted]' : value)));
    for (const session of sessions) await cli('browser.close', { session }).catch(() => {});
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}
