import assert from 'node:assert/strict';
import http from 'node:http';

export async function verifyPageWorkflow({ cli, record, passed, stopBridge, startBridge }) {
  const events = [], loads = []; let drift = false;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/event') { events.push(Object.fromEntries(url.searchParams)); res.end('ok'); return; }
    const search = url.pathname === '/flow-search', results = url.pathname === '/flow-results';
    if (search || results) loads.push({ kind: search ? 'entry' : 'search', ...Object.fromEntries(url.searchParams) });
    const initial = { category: url.searchParams.get('category') || 'initial', keyword: url.searchParams.get('q') || '', page: 1 };
    const state = JSON.stringify(initial).replaceAll('<', '\\u003c');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`<!doctype html><title>Example public workflow</title>
      <form action="/flow-results"><label>Category filter <select id="category" name="category"><option value="initial">Initial</option><option value="books">Books</option><option value="music">Music</option><option value="news">News</option><option value="broken">Broken example</option><option value="slow">Slow example</option></select></label>
      <label>Search <input id="q" name="q" type="search"></label><button id="search">Search</button></form><button id="next" type="button">Next page</button>
      <article class="${drift ? 'changed-flow-row' : 'flow-row'}"><h3></h3></article>
      <script>
        window.publicResults=${state}; document.querySelector('#category').value=publicResults.category;
        function render(){document.querySelector('h3').textContent=publicResults.keyword+'|'+publicResults.category+'|'+publicResults.page;}
        document.querySelector('#category').addEventListener('change',e=>{fetch('/event?kind=category&value='+encodeURIComponent(e.target.value));if(!['broken','slow'].includes(e.target.value)){publicResults.category=e.target.value;render();}});
        document.querySelector('form').onsubmit=e=>{e.preventDefault();const form=e.target;fetch('/event?kind=search').then(()=>form.submit());};
        document.querySelector('#next').onclick=()=>{fetch('/event?kind=next');publicResults.page++;render();};render();
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port, session = 'example-page-workflow';
  async function settle(taskId) {
    for (let i = 0; i < 100; i++) {
      const state = (await cli('exploration.get', { taskId })).data;
      if (!['collecting', 'validating', 'installing'].includes(state.status)) return state;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Workflow task did not settle');
  }
  async function waitForPageRelease() {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try { return await cli('browser.get', { session, selector: 'h3', property: 'text' }); }
      catch (error) { if (!error.stdout || JSON.parse(error.stdout).error?.code !== 'TAB_BUSY') throw error; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Cancelled workflow did not release the page within five seconds');
  }
  try {
    const tabId = (await cli('browser.open', { session, url: origin + '/entry' })).data.tabId;
    const state = { strategy: 'DOM_STATE', path: ['publicResults'] };
    const result = { strategy: 'UI_SELECTOR', selector: '.flow-row', fields: { title: { selector: 'h3' } } };
    const source = { mode: 'workflow', timeoutMs: 15000, steps: [
      { pathname: '/entry', query: { mode: 'navigate', resultPathname: '/flow-search', result: state, timeoutMs: 2000 } },
      { pathname: '/flow-search', query: { mode: 'filter', resultPathname: '/flow-search', result: state, trigger: { kind: 'filter', selector: '#category', parameter: 'category', description: 'Public content category' }, matchResult: { category: 'category' }, timeoutMs: 2000 } },
      { pathname: '/flow-search', query: { resultPathname: '/flow-results', result: state, trigger: { kind: 'search', selector: '#q', submitSelector: '#search', parameter: 'keyword', description: 'Public search term' }, matchQuery: { q: 'keyword' }, timeoutMs: 3000 } },
      { pathname: '/flow-results', query: { mode: 'filter', resultPathname: '/flow-results', result, trigger: { kind: 'pagination', selector: '#next' }, timeoutMs: 2000 } },
    ] };
    const taskId = (await cli('exploration.start', { tabId, goal: 'Filter public content, search and read the next page', requestId: 'example-multistep' })).data.taskId;
    await settle(taskId);
    events.length = 0;
    await cli('exploration.query', { taskId, source, values: { category: 'news', keyword: 'example-observation-only' }, reason: 'Ordered public navigation, filter, search and pagination' });
    const observed = await settle(taskId); assert.equal(observed.status, 'evidence_ready', JSON.stringify(observed));
    assert.deepEqual(events.map(event => event.kind), ['category', 'search', 'next']);
    const evidence = (await cli('exploration.evidence', { taskId })).data;
    assert.ok(!JSON.stringify(evidence).includes('example-observation-only'));
    const plan = { tools: [{ name: 'read-workflow', risk: 'read', strategy: 'UI_SELECTOR', sourcePageId: evidence.pageSources[0].id, readReason: 'Only public content queries' }] };
    const draft = (await cli('exploration.generate', { taskId, plan })).data, tool = draft.toolNames[0];
    const cases = [{ category: 'books', keyword: '007' }, { category: 'music', keyword: '示例' }].map((args, index) => ({ id: 'flow-' + index, args, expect: { equals: { 'data.items.0.title': `${args.keyword}|${args.category}|2` }, rowCount: { path: 'data.items', min: 1, max: 1 } } }));
    let before = (await cli('exploration.verification-read', { taskId, tool })).data;
    await cli('exploration.verification-write', { taskId, tool, expectedHash: before.hash, cases: cases.slice(0, 1) });
    assert.equal((await cli('exploration.validate', { taskId }, false)).error.code, 'VERIFICATION_REQUIRED');
    before = (await cli('exploration.verification-read', { taskId, tool })).data;
    await cli('exploration.verification-write', { taskId, tool, expectedHash: before.hash, cases });
    await cli('exploration.validate', { taskId }); const validated = await settle(taskId);
    assert.equal(validated.status, 'review_ready', JSON.stringify(validated));
    const review = (await cli('exploration.review', { taskId })).data;
    assert.ok(review.permissions.some(permission => permission.startsWith('page-workflow:')));
    await cli('exploration.install', { taskId, reviewId: review.reviewId, confirmed: true }); assert.equal((await settle(taskId)).status, 'installed');
    // Count actual website actions separately from catalog-triggered document reloads.
    events.length = 0;
    for (const args of [cases[0].args, cases[1].args, cases[1].args]) {
      const output = await cli(tool, args); assert.equal(output.data.items[0].title, `${args.keyword}|${args.category}|2`); assert.equal(output.workflow.completedSteps, 4);
    }
    assert.deepEqual(events.map(event => event.kind), Array(3).fill(['category', 'search', 'next']).flat());
    await record('page-workflow-document-loads', loads);
    events.length = 0;
    assert.equal((await cli(tool, { category: 'books' }, false)).ok, false); assert.equal(events.length, 0);
    const failed = await cli(tool, { category: 'broken', keyword: 'Example' }, false);
    assert.equal(failed.error.code, 'PAGE_QUERY_TIMEOUT'); assert.equal(failed.error.stepIndex, 1); assert.equal(failed.error.completedSteps, 1);
    assert.deepEqual(events.map(event => event.kind), ['category']);
    const knowledge = (await cli('exploration.knowledge-read', { site: review.name })).data;
    await cli('exploration.knowledge-save', { taskId, expectedHash: knowledge.hash });
    await record('page-workflow-validation', validated); await record('page-workflow-failure', failed);
    passed('ordered website workflow: navigation, correlated filter, cross-document search and next page; authored cases, permissions, repeat calls, invalid arguments and failed-step stop');

    const cancelTask = (await cli('exploration.start', { tabId, goal: 'Check cancellation of public query steps', requestId: 'example-flow-cancel' })).data.taskId;
    await settle(cancelTask); events.length = 0;
    const slow = structuredClone(source); slow.steps[1].query.timeoutMs = 10000;
    await cli('exploration.query', { taskId: cancelTask, source: slow, values: { category: 'slow', keyword: 'Example' }, reason: 'Read slow public filter' });
    for (let i = 0; i < 80 && !events.some(event => event.kind === 'category'); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(events.some(event => event.kind === 'category'));
    await cli('exploration.cancel', { taskId: cancelTask });
    await waitForPageRelease();
    assert.deepEqual(events.map(event => event.kind), ['category']);
    assert.equal((await cli('exploration.get', { taskId: cancelTask })).data.status, 'cancelled');
    passed('workflow cancellation stops later page actions and releases the page queue without replay');

    const restartId = (await cli('exploration.start', { tabId, goal: 'Check workflow interruption', requestId: 'example-flow-restart' })).data.taskId;
    await settle(restartId); events.length = 0;
    await cli('exploration.query', { taskId: restartId, source: slow, values: { category: 'slow', keyword: 'Example' }, reason: 'Observe an interruptible public filter' });
    for (let i = 0; i < 80 && !events.some(event => event.kind === 'category'); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(events.some(event => event.kind === 'category'));
    await stopBridge(); await startBridge();
    await waitForPageRelease();
    assert.deepEqual(events.map(event => event.kind), ['category']);
    assert.equal((await cli('exploration.get', { taskId: restartId })).data.status, 'interrupted');
    passed('Bridge loss stops the remaining workflow steps; restart keeps interruption without replay');

    const validationId = (await cli('exploration.start', { tabId, goal: 'Check workflow validation cancellation', requestId: 'example-flow-validation-cancel' })).data.taskId;
    await settle(validationId);
    await cli('exploration.query', { taskId: validationId, source: slow, values: cases[0].args, reason: 'Observe public workflow before cancellation verification' });
    await settle(validationId);
    const validationEvidence = (await cli('exploration.evidence', { taskId: validationId })).data.pageSources[0];
    const validationDraft = (await cli('exploration.generate', { taskId: validationId, plan: { tools: [{ ...plan.tools[0], name: 'cancel-validation-flow', sourcePageId: validationEvidence.id }] } })).data;
    const validationTool = validationDraft.toolNames[0];
    const validationCases = (await cli('exploration.verification-read', { taskId: validationId, tool: validationTool })).data;
    await cli('exploration.verification-write', { taskId: validationId, tool: validationTool, expectedHash: validationCases.hash, cases: [{ ...cases[0], args: { ...cases[0].args, category: 'slow' } }, cases[1]] });
    events.length = 0; await cli('exploration.validate', { taskId: validationId });
    for (let i = 0; i < 100 && !events.some(event => event.kind === 'category'); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(events.some(event => event.kind === 'category'));
    await cli('exploration.cancel', { taskId: validationId });
    await waitForPageRelease();
    assert.deepEqual(events.map(event => event.kind), ['category']);
    assert.equal((await cli('exploration.get', { taskId: validationId })).data.status, 'cancelled');
    passed('author validation cancellation stops the active workflow and does not start the next saved case');

    drift = true;
    const repairId = (await cli('exploration.start', { tabId, goal: 'Repair changed public result markup', requestId: 'example-flow-repair' })).data.taskId;
    await settle(repairId);
    const changed = structuredClone(source); changed.steps.at(-1).query.result.selector = '.changed-flow-row';
    await cli('exploration.query', { taskId: repairId, source: changed, values: cases[0].args, reason: 'Read changed public result markup' });
    assert.equal((await settle(repairId)).status, 'evidence_ready');
    const fresh = (await cli('exploration.evidence', { taskId: repairId })).data.pageSources[0];
    const info = (await cli('exploration.repair-info', { site: review.name })).data;
    await cli('exploration.repair', { taskId: repairId, site: review.name, expectedDigest: info.digest, plan: { tools: [{ ...plan.tools[0], sourcePageId: fresh.id }] } });
    await cli('exploration.validate', { taskId: repairId }); assert.equal((await settle(repairId)).status, 'draft');
    const file = 'extension/commands/read-workflow.js';
    const old = (await cli('exploration.draft-read', { taskId: repairId, file })).data;
    await cli('exploration.draft-write', { taskId: repairId, file, expectedHash: old.hash, content: old.content.replaceAll('.flow-row', '.changed-flow-row') });
    await cli('exploration.validate', { taskId: repairId }); const repaired = await settle(repairId);
    assert.equal(repaired.status, 'review_ready', JSON.stringify(repaired));
    const repairReview = (await cli('exploration.review', { taskId: repairId })).data;
    await cli('exploration.install', { taskId: repairId, reviewId: repairReview.reviewId, confirmed: true }); await settle(repairId);
    assert.equal((await cli(tool, cases[0].args)).data.items[0].title, '007|books|2');
    passed('workflow result drift fails saved cases; scoped extraction repair preserves action permissions and revalidates every step');
  } finally {
    await cli('browser.close', { session }).catch(() => {});
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}
