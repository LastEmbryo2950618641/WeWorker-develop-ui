import assert from 'node:assert/strict';
import http from 'node:http';

// Owned loopback service and public placeholder login only. No user browser.
export async function verifyBackgroundApi({ browser, cli, record, passed, stopBridge, startBridge }) {
  let drift = false, revoked = false, origin, apiOrigin;
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push({ method: req.method, path: url.pathname, authenticated: req.headers.authorization === 'Bearer example-session-placeholder' });
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'authorization,content-type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (url.pathname === '/api/list') {
      if (revoked || req.headers.authorization !== 'Bearer example-session-placeholder') { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"Example login required"}'); return; }
      const send = period => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ period, [drift ? 'remaining' : 'available']: period === '5h' ? 75 : 90 })); };
      if (req.method === 'POST') { let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => send(JSON.parse(body).period)); }
      else send(url.searchParams.get('period') || '5h');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'example_session=example-session-placeholder; Path=/; SameSite=Lax' });
    res.end(`<!doctype html><title>Public background API fixture</title><h1>Example quota</h1><script>
      const token=document.cookie.split('; ').find(v=>v.startsWith('example_session=')).split('=')[1];
      fetch(${JSON.stringify(apiOrigin + '/api/list?period=5h')},{headers:{authorization:'Bearer '+token}}).then(r=>r.json()).then(v=>window.exampleQuota=v);
    </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  apiOrigin = 'http://127.0.0.1:' + server.address().port;
  origin = 'http://background.example.org:' + server.address().port;
  const session = 'example-background-api';
  const settle = async taskId => {
    for (let i = 0; i < 150; i++) {
      const state = (await cli('exploration.get', { taskId })).data;
      if (!['collecting', 'validating', 'installing'].includes(state.status)) return state;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw Error('Background acceptance did not settle');
  };
  const edit = async (taskId, file, content) => {
    const before = (await cli('exploration.draft-read', { taskId, file })).data;
    await cli('exploration.draft-write', { taskId, file, content, expectedHash: before.hash });
  };
  const start = async label => {
    const tabId = (await cli('browser.open', { session, url: origin })).data.tabId;
    const taskId = (await cli('exploration.start', { tabId, allowedOrigins: [apiOrigin], goal: 'Read public example quota without a business page', requestId: 'background-' + label })).data.taskId;
    await settle(taskId);
    let evidence, index;
    for (let attempt = 0; attempt < 20; attempt++) {
      evidence = (await cli('exploration.evidence', { taskId })).data;
      index = evidence.candidates.findIndex(item => item.url.startsWith(apiOrigin + '/api/list') && item.status === 200);
      if (index >= 0) break;
      await new Promise(resolve => setTimeout(resolve, 150)); await cli('exploration.collect', { taskId }); await settle(taskId);
    }
    assert.ok(index >= 0, JSON.stringify(evidence)); return { taskId, index };
  };
  const plan = (index, name, strategy = 'EXTENSION_API') => ({ tools: [{ name, risk: 'read', strategy, sourceApiKind: 'list', sourceApiIndexes: [index],
    readReason: 'Read quota for a public period', strategyNote: { reason: 'Observed cookie-derived API header; background helpers can reuse it', alternatives: 'DOM and page fetch add an unnecessary business page dependency', limitations: 'Requires a valid cookie in this browser profile' } }] });
  const source = (id, field = 'available', method = 'GET') => `window.__webcliRegisterCommand(${JSON.stringify(id)},async args=>{
    const runtime=window.__webmcpWecliRuntime;
    const values=runtime.validateArgs(args,{type:'object',properties:{period:{type:'string',enum:['5h','week']}},required:['period'],additionalProperties:false});
    const result=await runtime.requestPrivileged('cookies_get',{url:${JSON.stringify(origin)},names:['example_session'],browserDebugger:false});
    const cookie=result.cookies.find(item=>item.name==='example_session');if(!cookie)throw Error('EXAMPLE_LOGIN_REQUIRED');
    const response=await runtime.requestPrivileged('backend_fetch',{url:${JSON.stringify(apiOrigin + '/api/list')}${method === 'GET' ? "+'?period='+encodeURIComponent(values.period)" : ''},browserFallback:false,redactBodyInTrace:true,options:{method:${JSON.stringify(method)},headers:{authorization:'Bearer '+cookie.value,'content-type':'application/json'}${method === 'POST' ? ',body:JSON.stringify({period:values.period})' : ''}}});
    if(!response.ok)throw Error('EXAMPLE_HTTP_ERROR');const data=JSON.parse(response.body);return {period:data.period,available:data.${field}};
  });`;
  const author = async (taskId, id, field = 'available', method = 'GET') => {
    const manifest = JSON.parse((await cli('exploration.draft-read', { taskId, file: 'manifest.json' })).data.content);
    const command = manifest.commands.find(command => command.id === id);
    assert.deepEqual(command.execution, { type: 'api', runtime: 'background' });
    command.schema = { type: 'object', properties: { period: { type: 'string', enum: ['5h', 'week'] } }, required: ['period'], additionalProperties: false, 'x-webcli-agent-authored': true };
    await edit(taskId, 'manifest.json', JSON.stringify(manifest, null, 2));
    await edit(taskId, command.module, source(id, field, method));
    const tool = manifest.name + '.' + id, before = (await cli('exploration.verification-read', { taskId, tool })).data;
    await cli('exploration.verification-write', { taskId, tool, expectedHash: before.hash, cases: ['5h', 'week'].map(period => ({ id: 'example-' + period, args: { period }, expect: { equals: { period, available: period === '5h' ? 75 : 90 } } })) });
    return { manifest, command, tool };
  };
  const validate = async (taskId, expected = 'review_ready') => {
    await cli('exploration.validate', { taskId }); const result = await settle(taskId);
    assert.equal(result.status, expected, JSON.stringify(result)); return result;
  };
  const install = async taskId => {
    const review = (await cli('exploration.review', { taskId })).data;
    await cli('exploration.install', { taskId, reviewId: review.reviewId, confirmed: true });
    assert.equal((await settle(taskId)).status, 'installed');
  };
  const call = async (tool, args) => { const { trace_id, ...value } = await cli(tool, args); return value; };
  const noPage = () => assert.ok(browser.pages().every(page => ![origin, apiOrigin].some(url => page.url().startsWith(url))), 'No fixture website or API-origin page may be open');
  try {
    const initial = await start('initial');
    await cli('exploration.generate', { taskId: initial.taskId, plan: plan(initial.index, 'quota') });
    const authored = await author(initial.taskId, 'quota');
    await cli('browser.close', { session }); noPage();
    const pageRequests = requests.filter(row => row.path === '/').length;
    const validation = await validate(initial.taskId); await install(initial.taskId);
    for (const period of ['5h', 'week', '5h']) assert.deepEqual(await call(authored.tool, { period }), { period, available: period === '5h' ? 75 : 90 });
    noPage(); assert.equal(requests.filter(row => row.path === '/').length, pageRequests);
    passed('background API generation, no-page validation, installation and repeated 5h/week calls');
    const knowledge = (await cli('exploration.knowledge-read', { site: authored.manifest.name })).data;
    await cli('exploration.knowledge-save', { taskId: initial.taskId, expectedHash: knowledge.hash });

    const incremental = await start('incremental');
    const mixedPlan = plan(incremental.index, 'quota_post');
    mixedPlan.tools.push({ ...plan(incremental.index, 'quota_page', 'PAGE_FETCH').tools[0] });
    await cli('exploration.generate', { taskId: incremental.taskId, plan: mixedPlan });
    const next = await author(incremental.taskId, 'quota-post', 'available', 'POST');
    assert.deepEqual(next.manifest.commands.find(command => command.id === 'quota'), authored.command);
    assert.equal((await cli('exploration.draft-read', { taskId: incremental.taskId, file: authored.command.module })).data.content, source('quota'));
    const pageCommand = next.manifest.commands.find(command => command.id === 'quota-page');
    await edit(incremental.taskId, pageCommand.module, `window.__webcliRegisterCommand('quota-page',async()=>{const token=document.cookie.split('; ').find(v=>v.startsWith('example_session=')).split('=')[1];const r=await fetch(${JSON.stringify(apiOrigin + '/api/list?period=5h')},{headers:{authorization:'Bearer '+token}});if(!r.ok)throw Error('EXAMPLE_HTTP_ERROR');return r.json();});`);
    const pageTool = next.manifest.name + '.quota-page', pageCases = (await cli('exploration.verification-read', { taskId: incremental.taskId, tool: pageTool })).data;
    await cli('exploration.verification-write', { taskId: incremental.taskId, tool: pageTool, expectedHash: pageCases.hash,
      cases: [{ id: 'example-page', args: {}, expect: { equals: { period: '5h', available: 75 } } }] });
    const mixed = await validate(incremental.taskId); assert.equal(mixed.runtimeValidation.executionSummary.passed, 3);
    await install(incremental.taskId);
    assert.deepEqual(await call(pageTool, {}), { period: '5h', available: 75 });
    await cli('browser.close', { session });
    assert.deepEqual(await call(next.tool, { period: 'week' }), { period: 'week', available: 90 });
    assert.deepEqual(await call(authored.tool, { period: '5h' }), { period: '5h', available: 75 });
    noPage(); passed('mixed page/background validation and incremental retention; installed page, read POST and existing GET use their original runners');

    drift = true;
    const repair = await start('repair'), info = (await cli('exploration.repair-info', { site: authored.manifest.name })).data;
    const downgrade = await cli('exploration.repair', { taskId: repair.taskId, site: info.site, expectedDigest: info.digest, plan: plan(repair.index, 'quota', 'PAGE_FETCH') }, false);
    assert.equal(downgrade.error.code, 'REPAIR_EXECUTION_MISMATCH');
    await cli('exploration.repair', { taskId: repair.taskId, site: info.site, expectedDigest: info.digest, plan: plan(repair.index, 'quota') });
    await cli('browser.close', { session }); await validate(repair.taskId, 'draft');
    await author(repair.taskId, 'quota', 'remaining');
    await validate(repair.taskId); await install(repair.taskId);
    assert.deepEqual(await call(authored.tool, { period: 'week' }), { period: 'week', available: 90 });
    noPage(); passed('background repair rejects page downgrade; stale result mapping fails and corrected no-page mapping passes');

    await stopBridge(); await startBridge();
    assert.deepEqual(await call(authored.tool, { period: '5h' }), { period: '5h', available: 75 });
    noPage(); passed('background installed call survives a real Bridge restart without business tabs');

    const expired = await start('expired');
    const latest = (await cli('exploration.repair-info', { site: info.site })).data;
    await cli('exploration.repair', { taskId: expired.taskId, site: info.site, expectedDigest: latest.digest, plan: plan(expired.index, 'quota') });
    await author(expired.taskId, 'quota', 'remaining');
    await cli('browser.close', { session });
    await browser.clearCookies({ name: 'example_session', domain: 'background.example.org' });
    const beforeExpiry = requests.length;
    await validate(expired.taskId, 'draft');
    assert.equal(requests.length, beforeExpiry, 'Missing cookie must fail without opening a login page or sending API requests');
    noPage();
    passed('missing login cookie blocks validation with no website navigation or API replay');
    await browser.addCookies([{ name: 'example_session', value: 'example-session-placeholder', url: origin }]);
    revoked = true;
    await validate(expired.taskId, 'draft');
    assert.equal(requests.length, beforeExpiry + 2, 'Exactly one 401 request per authored case, with no transport or browser fallback');
    assert.ok(requests.slice(beforeExpiry).every(item => item.path === '/api/list'));
    noPage(); passed('server-side login expiry fails each case once without opening a page or replaying');
    await record('background-api', { validation, requests, checks: ['closed-tab-preview', 'installed-get-post', 'incremental-retention', 'scoped-repair', 'restart', 'missing-cookie', 'server-login-expiry'] });
  } finally {
    await cli('browser.close', { session }, false).catch(() => {});
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
