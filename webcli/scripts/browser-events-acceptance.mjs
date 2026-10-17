// Shared real-browser checks: the isolated runner and an explicitly selected
// source Bridge can both use this fixture without observing unrelated tabs.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await delay(25);
  }
}

export async function verifyBrowserEvents({ cli, cliEntry, env = process.env, stopBridge, startBridge, detach, record, passed }) {
  const session = 'example-events', children = [], requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/events') {
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><title>Example event stream</title><button id="burst">Emit example</button><iframe src="http://localhost:${server.address().port}/events-child"></iframe>
        <script>document.querySelector('#burst').onclick=async()=>{
          for(let i=0;i<3;i++)console.log('Example stream root '+i);
          await fetch('/events-api?token=placeholder-secret').then(r=>r.json());
          await fetch('/events-redirect').then(r=>r.json());
          await fetch('/events-failure',{method:'POST'}).catch(()=>{});
        };</script>`);
    } else if (url.pathname === '/events-child') {
      res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Example child events</title><button id="child" onclick="console.warn(\'Example stream child\');fetch(\'/events-api?source=child\').then(r=>r.json())">Emit child</button>');
    } else if (url.pathname.startsWith('/events-')) {
      requests.push({ path: url.pathname, source: url.searchParams.get('source') });
      if (url.pathname === '/events-failure') { req.resume(); res.destroy(); return; }
      if (url.pathname === '/events-redirect') { res.writeHead(302, {location:'/events-result'}); res.end(); return; }
      res.writeHead(200, {'content-type':'application/json', 'cache-control':'no-store'});
      res.end(JSON.stringify({value:'Example response', token:'placeholder-secret'}));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/events`;
  const call = (command, args = {}, ok = true) => cli(`browser.${command}`, {session, ...args}, ok);
  function stream(channel, args = {}) {
    const child = spawn(process.execPath, [cliEntry, 'call', `browser.${channel}`, '--follow', '--args', JSON.stringify({session, intervalMs:100, ...args})], {env, stdio:['ignore','pipe','pipe']});
    const item = {child, lines:[], stderr:'', exit:null, pending:''}; children.push(item);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      item.pending += chunk;
      for (let end; (end = item.pending.indexOf('\n')) >= 0;) {
        const line = item.pending.slice(0, end); item.pending = item.pending.slice(end + 1);
        try { item.lines.push(JSON.parse(line)); } catch { item.parseError = line; }
      }
    });
    child.stderr.on('data', chunk => item.stderr += chunk);
    item.closed = new Promise(resolve => child.once('close', (code, signal) => { item.exit = {code,signal}; resolve(item.exit); }));
    item.ready = async () => {
      await until(() => item.lines.some(line => line.event === 'ready') || item.exit, 'Follow did not become ready');
      assert.equal(item.exit, null, JSON.stringify({lines:item.lines,stderr:item.stderr,parseError:item.parseError,pending:item.pending}));
    };
    item.done = async code => {
      await until(() => item.exit, 'Follow process did not exit'); await item.closed;
      assert.equal(item.exit.code, code, JSON.stringify({lines:item.lines,stderr:item.stderr})); assert.equal(item.parseError, undefined);
      return item.lines;
    };
    return item;
  }
  try {
    const opened = await call('open', {url});
    const consoleCursor = (await call('events', {channel:'console'})).data.nextCursor;
    const networkCursor = (await call('events', {channel:'network'})).data.nextCursor;
    const one = stream('console', {cursor:consoleCursor, match:'Example stream', maxEvents:4});
    const two = stream('console', {cursor:consoleCursor, match:'Example stream', maxEvents:4});
    const network = stream('network', {cursor:networkCursor, match:'/events-', maxEvents:5});
    await Promise.all([one.ready(), two.ready(), network.ready()]);
    await call('click', {selector:'#burst'});
    const frame = (await call('frames')).data.frames.find(item => item.url.endsWith('/events-child'));
    assert.ok(frame); await call('click', {frameId:frame.frameId,documentId:frame.documentId,selector:'#child'});
    await Promise.all([one.done(0), two.done(0), network.done(0)]);
    const consoleRows = one.lines.filter(line => line.event === 'entry').map(line => line.data);
    assert.deepEqual(consoleRows.map(row => row.text), ['Example stream root 0','Example stream root 1','Example stream root 2','Example stream child']);
    assert.deepEqual(consoleRows, two.lines.filter(line => line.event === 'entry').map(line => line.data));
    assert.equal(new Set(consoleRows.map(row => row.eventCursor)).size, 4); assert.equal(consoleRows[3].source,'child-frame');
    const netRows = network.lines.filter(line => line.event === 'entry').map(line => line.data);
    assert.equal(netRows.filter(row => row.phase === 'redirect').length,1);
    assert.equal(netRows.filter(row => row.phase === 'failed').length,1);
    const childRow = netRows.find(row => row.url.includes('source=child')); assert.equal(childRow.source,'child-frame');
    const detail = (await call('network', {detail:childRow.key})).data;
    assert.equal(detail.entry.response.value,'Example response'); assert.equal(detail.entry.response.token,'[redacted]');
    assert.equal(JSON.stringify(netRows).includes('placeholder-secret'),false);
    assert.equal(netRows.some(row => 'requestId' in row || 'request' in row || 'response' in row),false);
    assert.equal(requests.filter(item => item.path === '/events-api').length,2);
    assert.equal(requests.filter(item => item.path === '/events-result').length,1);
    assert.equal((await call('network', {detail:netRows.find(row=>row.phase==='redirect').key})).data.entry.response.omitted,true);
    const oneShot=(await call('console',{follow:false,since:'1m',until:'0ms',match:'Example stream'})).data;
    assert.equal(oneShot.entries.length,3); assert.equal(oneShot.observationVersion,undefined);
    assert.ok((await call('network',{since:'1m',until:'0ms',match:'/events-'})).data.entries.length>0);
    const checkpoint = one.lines.at(-1).cursor;
    const timed = stream('console', {cursor:checkpoint, match:'Example stream', durationMs:350}); await timed.done(0);
    assert.equal(timed.lines.at(-1).reason,'duration'); assert.equal(timed.lines.filter(line=>line.event==='entry').length,0);
    for (const [signal, code] of [['SIGINT',130],['SIGTERM',143]]) {
      const interrupted = stream('console', {cursor:checkpoint, match:'Example stream'}); await interrupted.ready(); interrupted.child.kill(signal); await interrupted.done(code);
      assert.equal(interrupted.lines.at(-1).reason,signal);
    }
    const piped = stream('console', {cursor:checkpoint, match:'Example pipe'}); await piped.ready(); piped.child.stdout.destroy();
    await call('eval', {expression:"console.log('Example pipe closed');true"}); await piped.done(0); assert.equal(piped.stderr,'');
    passed('JSONL follow: two independent subscribers, concurrent native input, root/child console and network, redacted detail, redirect/failure, limits/signals/closed pipe');

    if (stopBridge && startBridge) {
      const cursor = (await call('events',{channel:'console'})).data.nextCursor;
      const disconnected = stream('console',{cursor,match:'Example resume'}); await disconnected.ready();
      await stopBridge(); await disconnected.done(1);
      assert.ok(['BRIDGE_DISCONNECTED','BRIDGE_UNAVAILABLE'].includes(disconnected.lines.at(-1).error.code));
      assert.equal(disconnected.lines.at(-1).cursor,cursor);
      await startBridge();
      await call('eval',{expression:"console.log('Example resume once');true"});
      const resumed=stream('console',{cursor,match:'Example resume',maxEvents:1});await resumed.done(0);
      assert.equal(resumed.lines.filter(line=>line.event==='entry').length,1);
      assert.equal(resumed.lines.at(-1).entries,1);
      passed('follow stops on Bridge loss and explicitly resumes its saved extension cursor after restart without duplicates');
    }
    const baseline = (await call('events',{channel:'console'})).data.nextCursor;
    await call('eval',{expression:"console.info('Example deferred');true"});
    const deferred=(await call('events',{channel:'console',cursor:baseline,match:'Example deferred',until:'2s',since:'1m'})).data;
    assert.equal(deferred.entries.length,0);assert.equal(deferred.deferred,true);assert.equal(deferred.nextCursor,baseline);
    await delay(2100);
    assert.equal((await call('events',{channel:'console',cursor:baseline,match:'Example deferred',until:'2s'})).data.entries.length,1);
    const beforeOverflow=(await call('events',{channel:'console'})).data.nextCursor;
    await call('eval',{expression:"for(let i=0;i<205;i++) console.log('Example overflow '+i);true"});
    assert.equal((await call('events',{channel:'console',cursor:beforeOverflow},false)).error.code,'OBSERVATION_CURSOR_EXPIRED');
    const expired=stream('console',{cursor:beforeOverflow});await expired.done(1);assert.equal(expired.lines.at(-1).error.code,'OBSERVATION_CURSOR_EXPIRED');
    const snapshot=(await call('events',{channel:'console',limit:200})).data;
    assert.equal(snapshot.entries.length,200);assert.equal(snapshot.truncated,true);
    if (detach) {
      await detach(opened.data.tabId);
      assert.equal((await call('events',{channel:'console',cursor:snapshot.nextCursor},false)).error.code,'OBSERVATION_CONTEXT_EXPIRED');
      await call('open',{url});
      assert.equal((await call('events',{channel:'console',cursor:snapshot.nextCursor},false)).error.code,'OBSERVATION_CURSOR_EXPIRED');
    }
    passed('rolling time window defers young events; bounded history loss' + (detach ? ' and debug detach' : '') + ' invalidate cursors explicitly');
    await record('browser-events', {consoleCount:consoleRows.length,networkCount:netRows.length,independentSubscribers:2,signals:['SIGINT','SIGTERM'],closedPipe:true,requests,detachTested:!!detach});
  } finally {
    for (const item of children) if (!item.exit) { item.child.kill('SIGTERM'); await item.closed; }
    try { await call('close'); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}
