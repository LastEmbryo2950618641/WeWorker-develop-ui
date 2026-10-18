import assert from 'node:assert/strict';
import http from 'node:http';

export async function verifyWorkflowControl({ cli, record, passed, stopBridge, startBridge }) {
  const requests = [], sessions = [];
  let drift = false, revision = 0, documents = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost'); res.setHeader('cache-control', 'no-store');
    if (url.pathname === '/data') {
      const category = url.searchParams.get('category'), page = Number(url.searchParams.get('page'));
      requests.push({ category, page });
      const id = ['duplicate', 'conflict'].includes(category) ? '007' : String(6 + page).padStart(3, '0');
      const items = category === 'limit' ? [0, 1, 2].map(i => ({ id: String(page * 3 + i), title: 'Example' })) : [{ id, title: category === 'conflict' ? 'Example ' + page : 'Example' }];
      const data = { category, page, items, hasNext: page < (category === 'single' ? 1 : category === 'exhausted' ? 8 : 3), revision: ++revision };
      setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); }, category === 'slow' && page === 2 ? 5000 : 200); return;
    }
    if (url.pathname != '/control') { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', 'text/html'); documents++;
    const field = drift ? 'changedResult' : 'publicResult';
    res.end(`<!doctype html><title>Public pagination fixture</title><h1>Public pages</h1>
      <select id="category" aria-label="Category">${['initial','many','single','duplicate','conflict','exhausted','limit','slow','example-unretained-control'].map(x => '<option>' + x + '</option>').join('')}</select>
      <button id="next">Next page</button><script>
      let page=0; window.${field}={category:'initial',page:0,items:[],hasNext:false,revision:0};
      async function load(){window.${field}=await(await fetch('/data?category='+encodeURIComponent(document.querySelector('#category').value)+'&page='+page)).json();}
      document.querySelector('#category').onchange=()=>{page=1;load()};
      document.querySelector('#next').onclick=()=>{page++;load()};
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const settle = async taskId => {
    for (let i = 0; i < 160; i++) {
      const state = (await cli('exploration.get', { taskId })).data;
      if (!['collecting','validating','installing'].includes(state.status)) return state;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw Error('Control workflow did not settle');
  };
  const sourceFor = field => ({ mode: 'workflow', timeoutMs: 20000, steps: [
    { pathname: '/control', query: { mode: 'navigate', resultPathname: '/control', result: { strategy: 'UI_SELECTOR', selector: 'h1', fields: { title: {} } } } },
    { pathname: '/control', query: { mode: 'filter', resultPathname: '/control', trigger: { kind: 'filter', selector: '#category', parameter: 'category', description: 'Public category' }, matchResult: { category: 'category' }, result: { strategy: 'DOM_STATE', path: [field] }, timeoutMs: 8000 } },
    { pathname: '/control', when: { path: 'hasNext', equals: true }, repeat: { maxIterations: 3, until: { path: 'hasNext', equals: false }, collect: { path: 'items', identityPath: 'id', maxItems: 4, includePrevious: true } },
      query: { mode: 'filter', resultPathname: '/control', trigger: { kind: 'pagination', selector: '#next' }, result: { strategy: 'DOM_STATE', path: [field] }, timeoutMs: 8000 } },
  ] });
  const open = async name => {
    const session = 'example-control-' + name; sessions.push(session);
    const tabId = (await cli('browser.open', { session, url: origin + '/control' })).data.tabId;
    const taskId = (await cli('exploration.start', { tabId, goal: 'Read public bounded pages', requestId: session })).data.taskId;
    await settle(taskId); return { session, tabId, taskId };
  };
  const observe = async (taskId, source, category = 'example-unretained-control') => {
    await cli('exploration.query', { taskId, source, values: { category }, reason: 'Read public category pages until the explicit end' });
    const state = await settle(taskId); assert.equal(state.status, 'evidence_ready', JSON.stringify(state));
    return (await cli('exploration.evidence', { taskId })).data;
  };
  const released = async session => {
    const end = Date.now() + 4000;
    while (true) {
      try { await cli('browser.get', { session, selector: 'h1', property: 'text' }); return; }
      catch (error) { if (Date.now() > end || !error.stdout || JSON.parse(error.stdout).error?.code !== 'TAB_BUSY') throw error; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  try {
    const { tabId, taskId } = await open('main');
    const source = sourceFor('publicResult'), evidence = await observe(taskId, source);
    assert.ok(!JSON.stringify(evidence).includes('example-unretained-control'));
    const plan = { tools: [{ name: 'read_control', risk: 'read', strategy: 'UI_SELECTOR', sourcePageId: evidence.pageSources[0].id, readReason: 'Public read-only bounded pagination' }] };
    const tool = (await cli('exploration.generate', { taskId, plan })).data.toolNames[0];
    const cases = ['many','single'].map((category, i) => ({ id: 'control-' + i, args: { category }, expect: { equals: {
      'data.category': category, 'data.hasNext': false, 'workflow.completedSteps': 3, 'workflow.skippedSteps': i,
      'workflow.executedActions': i ? 2 : 4, 'workflow.collections.0.items.0.id': '007', 'workflow.collections.0.iterations': i ? 0 : 2,
      ...(!i ? { 'workflow.collections.0.items.2.id': '009' } : {}),
    } } }));
    const beforeCases = (await cli('exploration.verification-read', { taskId, tool })).data;
    await cli('exploration.verification-write', { taskId, tool, expectedHash: beforeCases.hash, cases });
    await cli('exploration.validate', { taskId }); const verified = await settle(taskId); assert.equal(verified.status, 'review_ready', JSON.stringify(verified));
    const review = (await cli('exploration.review', { taskId })).data;
    assert.ok(review.permissions.some(x => x.includes('maxIterations') && x.includes('includePrevious')));
    await cli('exploration.install', { taskId, reviewId: review.reviewId, confirmed: true }); assert.equal((await settle(taskId)).status, 'installed');
    for (const category of ['many','single','many']) {
      const before = requests.length, docs = documents, actual = await cli(tool, { category });
      assert.deepEqual(actual.workflow.collections[0].items.map(x => x.id), category === 'single' ? ['007'] : ['007','008','009']);
      assert.deepEqual(requests.slice(before), (category === 'single' ? [1] : [1,2,3]).map(page => ({ category, page })));
      assert.equal(documents, docs + 1); assert.equal(actual.data.hasNext, false);
    }
    const known = (await cli('exploration.knowledge-read', { site: review.name })).data;
    await cli('exploration.knowledge-save', { taskId, expectedHash: known.hash });
    assert.ok(JSON.stringify((await cli('exploration.knowledge-read', { site: review.name })).data).includes('includePrevious'));
    await record('workflow-control-validation', verified);
    passed('controlled workflow: author cases cover repeated and skipped branch, initial-page collection, exact actions, install/call/knowledge and repeat calls');
    for (const [category, code, count] of [['duplicate','PAGE_WORKFLOW_NO_PROGRESS',2], ['conflict','PAGE_WORKFLOW_IDENTITY_CONFLICT',2], ['exhausted','PAGE_WORKFLOW_ITERATION_LIMIT',4], ['limit','PAGE_WORKFLOW_COLLECTION_LIMIT',2]]) {
      const before = requests.length, actual = await cli(tool, { category }, false);
      assert.equal(actual.error.code, code, JSON.stringify(actual)); assert.equal(actual.error.stepIndex, 2); assert.equal(actual.error.completedSteps, 2);
      assert.equal(actual.data, undefined); assert.equal(actual.workflow, undefined);
      assert.deepEqual(requests.slice(before), Array.from({ length: count }, (_, i) => ({ category, page: i + 1 })));
    }
    passed('controlled workflow refuses repeated identities, changed rows, iteration exhaustion and item overflow without partial data or extra actions');
    drift = true;
    const repairId = (await cli('exploration.start', { tabId, goal: 'Repair public page extraction', requestId: 'example-control-repair' })).data.taskId; await settle(repairId);
    const fresh = await observe(repairId, sourceFor('changedResult'), 'many');
    const info = (await cli('exploration.repair-info', { site: review.name })).data;
    await cli('exploration.repair', { taskId: repairId, site: review.name, expectedDigest: info.digest, plan: { tools: [{ ...plan.tools[0], name: 'read-control', sourcePageId: fresh.pageSources[0].id }] } });
    await cli('exploration.validate', { taskId: repairId }); assert.equal((await settle(repairId)).status, 'draft');
    const file = 'extension/commands/read-control.js', old = (await cli('exploration.draft-read', { taskId: repairId, file })).data;
    await cli('exploration.draft-write', { taskId: repairId, file, expectedHash: old.hash, content: old.content.replaceAll('publicResult','changedResult') });
    await cli('exploration.validate', { taskId: repairId }); assert.equal((await settle(repairId)).status, 'review_ready');
    const repaired = (await cli('exploration.review', { taskId: repairId })).data;
    await cli('exploration.install', { taskId: repairId, reviewId: repaired.reviewId, confirmed: true }); assert.equal((await settle(repairId)).status, 'installed');
    assert.equal((await cli(tool, { category: 'many' })).workflow.collections[0].items.length, 3);
    passed('controlled workflow repair preserves conditions, limits and collections and reruns both branch cases before install');
    drift = false;
    for (const kind of ['cancel','restart']) {
      const { session, taskId } = await open(kind), before = requests.length, docs = documents;
      await cli('exploration.query', { taskId, source, values: { category: 'slow' }, reason: 'Observe interrupted public pagination' });
      for (let i = 0; i < 160 && !requests.slice(before).some(x => x.page === 2); i++) await new Promise(resolve => setTimeout(resolve, 50));
      assert.deepEqual(requests.slice(before), [{ category: 'slow', page: 1 }, { category: 'slow', page: 2 }]);
      if (kind === 'cancel') await cli('exploration.cancel', { taskId }); else { await stopBridge(); await startBridge(); }
      await released(session);
      assert.equal((await cli('exploration.get', { taskId })).data.status, kind === 'cancel' ? 'cancelled' : 'interrupted');
      assert.equal(requests.length, before + 2); assert.equal(documents, docs + 1);
      assert.equal((await cli('exploration.evidence', { taskId })).data.pageSources.length, 0);
      passed('controlled workflow ' + kind + ': no next iteration, page reload or replay; queue released and late data discarded');
    }
    const { session: previewSession, taskId: previewId } = await open('validation-cancel');
    const previewEvidence = await observe(previewId, source, 'many');
    const previewTool = (await cli('exploration.generate', { taskId: previewId, plan: { tools: [{ ...plan.tools[0], name: 'read_control_cancel', sourcePageId: previewEvidence.pageSources[0].id }] } })).data.toolNames[0];
    const previewBefore = (await cli('exploration.verification-read', { taskId: previewId, tool: previewTool })).data;
    await cli('exploration.verification-write', { taskId: previewId, tool: previewTool, expectedHash: previewBefore.hash, cases: ['slow','single'].map((category, i) => ({ id: 'preview-' + i, args: { category }, expect: { equals: { 'data.category': category } } })) });
    const previewRequests = requests.length;
    await cli('exploration.validate', { taskId: previewId });
    for (let i = 0; i < 160 && !requests.slice(previewRequests).some(x => x.page === 2); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(requests.slice(previewRequests), [{ category: 'slow', page: 1 }, { category: 'slow', page: 2 }]);
    await cli('exploration.cancel', { taskId: previewId }); await released(previewSession);
    assert.equal((await cli('exploration.get', { taskId: previewId })).data.status, 'cancelled');
    assert.equal(requests.length, previewRequests + 2);
    passed('controlled author validation cancellation stops the next iteration and the next authored case without replay');
  } finally {
    await record('workflow-control-requests', JSON.parse(JSON.stringify({ requests, documents }, (_, value) => typeof value === 'string' && value.startsWith('example-unretained') ? '[observation omitted]' : value)));
    for (const session of sessions) await cli('browser.close', { session }).catch(() => {});
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}
