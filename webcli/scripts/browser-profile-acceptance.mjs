import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile), delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Two real Chromium profiles, the same installed extension and actual CLI processes. */
export async function verifyBrowserProfiles({ browser, launchSecond, cliEntry, env, stopBridge, startBridge, record, passed }) {
  const children = []; let second;
  const server = http.createServer((req, res) => {
    const label = new URL(req.url, 'http://127.0.0.1').searchParams.get('label') === 'B' ? 'B' : 'A';
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end(`<!doctype html><title>Example ${label}</title><article class="profile-row"><h2>Example ${label}</h2></article><input id="profile-value" aria-label="Example input"><button onclick="console.log('Example ${label} event')">Emit example</button>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, session = 'example-profile-work';
  async function cli(command, args = {}, profile, ok = true, extraEnv = {}) {
    let result;
    try { result = await exec(process.execPath, [cliEntry, ...(profile ? ['--profile', profile] : []), 'call', command, '--args', JSON.stringify(args), '--output-format=json'], { env: { ...env, ...extraEnv }, timeout: 95000, maxBuffer: 3_000_000 }); }
    catch (error) { if (ok) throw error; result = error; }
    const value = JSON.parse(result.stdout);
    assert.equal(value.ok, ok, JSON.stringify(value)); return value;
  }
  const call = (profile, command, args = {}, ok = true) => cli('browser.' + command, { session, ...args }, profile, ok);
  async function online(count) {
    for (let i = 0; i < 60; i++) {
      const list = (await cli('profile.list')).data.profiles.filter(item => item.online);
      if (list.length === count) return list;
      await delay(200);
    }
    throw new Error('Unexpected online profile count');
  }
  async function settle(taskId, profile) {
    for (let i = 0; i < 100; i++) {
      const task = (await cli('exploration.get', { taskId }, profile)).data;
      if (!['collecting', 'validating', 'installing'].includes(task.status)) return task;
      await delay(200);
    }
    throw new Error('Profile task did not settle');
  }
  const tasks = [];
  try {
    const a = (await online(1))[0].contextId;
    second = await launchSecond();
    const b = (await online(2)).find(item => item.contextId !== a).contextId;
    await cli('profile.rename', { contextId: a, name: 'example-work' });
    await cli('profile.rename', { contextId: b, name: 'example-personal' });
    assert.equal((await cli('browser.tabs', {}, undefined, false)).error.code, 'PROFILE_AMBIGUOUS');
    await call(a, 'open', { url: origin + '/profile-example?label=A' });
    await call(b, 'open', { url: origin + '/profile-example?label=B' });
    await Promise.all([call(a, 'fill', { selector: '#profile-value', value: 'Example first' }), call(b, 'fill', { selector: '#profile-value', value: 'Example second' })]);
    assert.equal((await call(a, 'get', { selector: '#profile-value', property: 'value' })).data.value, 'Example first');
    assert.equal((await call(b, 'get', { selector: '#profile-value', property: 'value' })).data.value, 'Example second');
    const ref = (await call(a, 'state')).data.elements.find(item => item.role === 'textbox').ref;
    await call(b, 'state');
    assert.equal((await call(b, 'fill', { ref, value: 'Must not enter another profile' }, false)).error.code, 'STALE_REF');
    const foreignCursor = (await call(a, 'events', { channel: 'console' })).data.nextCursor;
    assert.equal((await call(b, 'events', { channel: 'console', cursor: foreignCursor }, false)).error.code, 'OBSERVATION_CURSOR_EXPIRED');
    await cli('profile.use', { name: 'example-work' });
    assert.equal((await cli('browser.eval', { session, expression: 'document.title' })).data.value, 'Example A');
    assert.equal((await cli('browser.eval', { session, expression: 'document.title' }, undefined, true, { WEBCLI_PROFILE: 'example-personal' })).data.value, 'Example B');
    assert.equal((await cli('browser.eval', { session, expression: 'document.title' }, 'example-work', true, { WEBCLI_PROFILE: 'example-personal' })).data.value, 'Example A');
    passed('two real browser profiles: unique persistent IDs, aliases, ambiguity, default/env/flag precedence and identical session names');

    for (const [profile, label] of [[a, 'A'], [b, 'B']]) {
      const tabId = (await cli('browser.sessions', {}, profile)).data.sessions.find(item => item.session === session).tabId;
      const taskId = (await cli('exploration.start', { tabId, requestId: 'example-profile-exploration', goal: 'Read example visible rows' }, profile)).data.taskId;
      await cli('profile.use', { name: profile === a ? b : a });
      assert.equal((await settle(taskId, profile)).status, 'evidence_ready');
      assert.equal((await cli('exploration.get', { taskId }, profile === a ? b : a, false)).error.code, 'TASK_NOT_FOUND');
      await cli('exploration.observe', { taskId, source: { strategy: 'UI_SELECTOR', selector: '.profile-row', fields: { title: { selector: 'h2' } } }, reason: 'Read visible public fixture text.' }, profile);
      await settle(taskId, profile);
      const evidence = (await cli('exploration.evidence', { taskId }, profile)).data;
      const draft = (await cli('exploration.generate', { taskId, plan: { tools: [{ name: 'read_profile_' + label.toLowerCase(), risk: 'read', strategy: 'UI_SELECTOR', sourcePageId: evidence.pageSources[0].id, purpose: 'Read example profile rows', readReason: 'Read visible public fixture text without mutation.' }] } }, profile)).data;
      const tool = draft.toolNames[0], verification = (await cli('exploration.verification-read', { taskId, tool }, profile)).data;
      await cli('exploration.verification-write', { taskId, tool, expectedHash: verification.hash, cases: [{ id: 'example-profile', args: {}, expect: { equals: { 'data.items.0.title': 'Example ' + label }, rowCount: { path: 'data.items', min: 1, max: 1 } } }] }, profile);
      await cli('exploration.validate', { taskId }, profile);
      const validation = await settle(taskId, profile); assert.equal(validation.status, 'review_ready', JSON.stringify(validation));
      const review = (await cli('exploration.review', { taskId }, profile)).data;
      await cli('exploration.install', { taskId, reviewId: review.reviewId, confirmed: true }, profile);
      assert.equal((await settle(taskId, profile)).status, 'installed');
      tasks.push({ profile, taskId, tool });
      for (const [target, expected] of [[a, 'A'], [b, 'B']]) assert.equal((await cli(tool, {}, target)).data.items[0].title, 'Example ' + expected);
    }
    await cli('profile.use', { name: b });
    const traced = await exec(process.execPath, [cliEntry, '--profile', a, 'call', tasks[0].tool, '--verbose', '--output-format=json'], { env, timeout: 15000 });
    assert.equal(JSON.parse(traced.stdout).data.items[0].title, 'Example A');
    assert.ok(traced.stderr.includes('Extension'), 'Verbose trace must query the same browser selected for the Adapter call.');
    passed('both profiles complete exploration, strict validation and incremental installation; ordinary Adapter calls and verbose trace route to the selected browser');

    await cli('profile.use', { name: a });
    const cursor = (await call(a, 'events', { channel: 'console' })).data.nextCursor;
    const child = spawn(process.execPath, [cliEntry, 'call', 'browser.console', '--follow', '--args', JSON.stringify({ session, cursor, match: 'Example A event', maxEvents: 1, intervalMs: 100, durationMs: 15000 })], { env, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
    let output = '', errorOutput = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => errorOutput += chunk);
    const closed = new Promise(resolve => child.once('close', resolve));
    for (let i = 0; i < 100 && !output.includes('"ready"'); i++) await delay(50);
    assert.ok(output.includes('"ready"'), errorOutput);
    await cli('profile.use', { name: b });
    await call(b, 'eval', { expression: "console.log('Example B event');true" });
    await call(a, 'eval', { expression: "console.log('Example A event');true" });
    assert.equal(await closed, 0, errorOutput);
    const lines = output.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(lines.filter(line => line.event === 'entry').length, 1); assert.equal(lines.find(line => line.event === 'entry').contextId, a);
    passed('real JSONL follow stays in its initial profile when the persisted default changes');

    await stopBridge(); await startBridge(); await online(2);
    assert.equal((await cli('profile.list')).data.defaultContextId, b);
    for (const task of tasks) assert.equal((await cli('exploration.get', { taskId: task.taskId }, task.profile)).data.status, 'installed');
    for (const [profile, label] of [[a, 'A'], [b, 'B']]) assert.equal((await call(profile, 'eval', { expression: 'document.title' })).data.value, 'Example ' + label);
    passed('Bridge restart preserves both profile identities, aliases, default, sessions and exploration history');

    // Chrome for Testing allows command-line unpacked loading initially, but
    // disables that extension on reload unless this isolated profile enables developer mode.
    const manager = await second.newPage(); await manager.goto('chrome://extensions');
    await manager.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
    await second.serviceWorkers()[0].evaluate(() => { setTimeout(() => chrome.runtime.reload(), 100); });
    await delay(1200); await online(2); await manager.close();
    assert.equal((await cli('profile.list')).data.profiles.find(item => item.alias === 'example-personal').contextId, b);
    const reloadRead = await call(b, 'eval', { expression: 'document.title' }, false);
    assert.equal(reloadRead.error.code, 'SESSION_EXPIRED');
    await cli('browser.unbind', { session }, b);
    const tab = (await cli('browser.tabs', {}, b)).data.tabs.find(tab => tab.url.includes('/profile-example'));
    await call(b, 'bind', { tabId: tab.id });
    assert.equal((await call(b, 'eval', { expression: 'document.title' })).data.value, 'Example B');
    passed('extension reload retains profile identity and rejects expired tab bindings until explicit rebind');

    const pending = call(b, 'eval', { expression: 'new Promise(resolve=>setTimeout(()=>resolve(1),15000))' }, false);
    await delay(400); await second.close(); second = null; await online(1);
    assert.ok(['PROFILE_DISCONNECTED', 'BROWSER_OPERATION_FAILED'].includes((await pending).error.code), 'Browser shutdown must fail the action; Chrome may report debugger cancellation before the socket closes.');
    assert.equal((await cli('browser.tabs', {}, undefined, false)).error.code, 'PROFILE_OFFLINE');
    assert.equal((await cli('exploration.list', {}, b)).data.tasks.length, 1);
    assert.equal((await call(a, 'eval', { expression: 'document.title' })).data.value, 'Example A');
    second = await launchSecond(); await online(2);
    assert.equal((await cli('profile.list')).data.profiles.find(item => item.alias === 'example-personal').contextId, b);
    const stale = await call(b, 'eval', { expression: 'document.title' }, false);
    assert.ok(['SESSION_EXPIRED', 'TAB_NOT_FOUND'].includes(stale.error.code));
    await second.close(); second = null; await online(1);
    await cli('profile.use', { name: 'auto' });
    await record('browser-profiles', { contexts: [a, b], tasks, checks: lines.map(line => line.event) });
    passed('browser shutdown fails the action without replay; offline default/history and browser restart identity/expired-session checks pass');
    await call(a, 'close');
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await second?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
