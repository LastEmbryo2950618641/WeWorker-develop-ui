import assert from 'node:assert/strict';
import http from 'node:http';

export async function verifyPageSharedRepair({ cli, record, passed, stopBridge, startBridge }) {
  let drift = false; const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    if (req.url === '/items') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'example-item', [drift ? 'label' : 'title']: 'Public example' })); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Public shared repair</title><h1>Public example</h1><script>fetch("/items").then(r=>r.json()).then(v=>window.exampleReady=true)</script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://localhost:' + server.address().port, session = 'example-page-shared-repair';
  const shared = 'extension/internal/shared-map.js';
  const settle = async taskId => {
    for (let i = 0; i < 100; i++) {
      const state = (await cli('exploration.get', { taskId })).data;
      if (!['collecting', 'validating', 'installing'].includes(state.status)) return state;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('Shared repair did not settle');
  };
  const edit = async (taskId, file, content) => {
    const before = (await cli('exploration.draft-read', { taskId, file })).data;
    await cli('exploration.draft-write', { taskId, file, expectedHash: before.hash, content });
  };
  const mapper = field => `window.__exampleSharedMap = value => ({id:value.id,title:value.${field}});`;
  const install = async taskId => {
    const review = (await cli('exploration.review', { taskId })).data;
    await cli('exploration.install', { taskId, reviewId: review.reviewId, confirmed: true }); assert.equal((await settle(taskId)).status, 'installed');
  };
  try {
    const tabId = (await cli('browser.open', { session, url: origin })).data.tabId;
    const start = async label => {
      const taskId = (await cli('exploration.start', { tabId, goal: 'Repair a shared public field mapping', requestId: 'page-shared-' + label })).data.taskId;
      assert.equal((await settle(taskId)).status, 'evidence_ready');
      let evidence;
      for (let attempt = 0; attempt < 20; attempt++) {
        evidence = (await cli('exploration.evidence', { taskId })).data;
        if (evidence.candidates.some(item => item.url === origin + '/items' && item.responseEvidence?.bodyKind === 'json')) break;
        await new Promise(resolve => setTimeout(resolve, 150)); await cli('exploration.collect', { taskId }); await settle(taskId);
      }
      const index = evidence.candidates.findIndex(item => item.url === origin + '/items' && item.responseEvidence?.bodyKind === 'json');
      assert.notEqual(index, -1); return { taskId, index };
    };
    const initial = await start('initial');
    const plan = (index, initial = false) => ({ tools: (initial ? ['shared-first', 'shared-second'] : ['check-login-status', 'shared-first', 'shared-second']).map(id => ({ name: initial ? id.replaceAll('-', '_') : id, risk: 'read', strategy: 'PAGE_FETCH', sourceApiKind: 'list', sourceApiIndexes: [index],
      strategyNote: { reason: 'Observed public loopback API', alternatives: 'No separate credentials', limitations: 'Public fixture only' } })) });
    const generated = (await cli('exploration.generate', { taskId: initial.taskId, plan: plan(initial.index, true) })).data;
    const manifest = JSON.parse((await cli('exploration.draft-read', { taskId: initial.taskId, file: 'manifest.json' })).data.content);
    assert.deepEqual(manifest.commands.map(command => command.id), ['check-login-status', 'shared-first', 'shared-second'], 'Include the generated login helper in shared repair impact');
    await cli('exploration.draft-add', { taskId: initial.taskId, file: shared, content: mapper('title') });
    for (const command of manifest.commands) {
      if (command.id === 'check-login-status') continue;
      await edit(initial.taskId, command.module, `window.__webcliRegisterCommand(${JSON.stringify(command.id)},async()=>{const response=await fetch(${JSON.stringify(origin + '/items')});if(!response.ok)throw Error('HTTP status');return window.__exampleSharedMap(await response.json());});`);
      const tool = manifest.name + '.' + command.id, before = (await cli('exploration.verification-read', { taskId: initial.taskId, tool })).data;
      await cli('exploration.verification-write', { taskId: initial.taskId, tool, expectedHash: before.hash, cases: [{ id: 'example-title', args: {}, expect: { equals: { id: 'example-item', title: 'Public example' } } }] });
    }
    await cli('exploration.validate', { taskId: initial.taskId }); assert.equal((await settle(initial.taskId)).status, 'review_ready');
    await install(initial.taskId);
    const knowledge = (await cli('exploration.knowledge-read', { site: manifest.name })).data;
    await cli('exploration.knowledge-save', { taskId: initial.taskId, expectedHash: knowledge.hash });
    drift = true;
    const repair = await start('repair'), info = (await cli('exploration.repair-info', { site: manifest.name })).data;
    await cli('exploration.repair', { taskId: repair.taskId, site: manifest.name, expectedDigest: info.digest, sharedFiles: [shared], plan: plan(repair.index) });
    const loginTool = manifest.name + '.check-login-status';
    const loginCases = (await cli('exploration.verification-read', { taskId: repair.taskId, tool: loginTool })).data;
    await cli('exploration.verification-write', { taskId: repair.taskId, tool: loginTool, expectedHash: loginCases.hash,
      cases: [{ id: 'example-public-page', args: {}, expect: { equals: { logged_in: true, on_login_page: false, current_url: origin + '/' } } }] });
    await cli('exploration.validate', { taskId: repair.taskId }); assert.equal((await settle(repair.taskId)).status, 'draft');
    await edit(repair.taskId, shared, mapper('label'));
    await cli('exploration.validate', { taskId: repair.taskId });
    const validated = await settle(repair.taskId); assert.equal(validated.status, 'review_ready', JSON.stringify(validated));
    assert.deepEqual(validated.runtimeValidation.executionSummary, { attempted: 3, passed: 3, failed: 0, skipped: 0 });
    await install(repair.taskId);
    for (const tool of generated.toolNames) assert.equal((await cli(tool)).title, 'Public example');
    await stopBridge(); await startBridge();
    assert.deepEqual((await cli('exploration.get', { taskId: repair.taskId })).data.repair.sharedFiles, [shared]);
    for (const tool of generated.toolNames) assert.equal((await cli(tool)).title, 'Public example');
    assert.ok(requests.every(request => request.method === 'GET'));
    await record('shared-page-repair', { validation: validated, requests });
    passed('Extension shared mapper drift fails both old cases; exact shared scope, complete revalidation, install and restart calls pass without writes');
  } finally {
    await cli('browser.close', { session }).catch(() => {});
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
