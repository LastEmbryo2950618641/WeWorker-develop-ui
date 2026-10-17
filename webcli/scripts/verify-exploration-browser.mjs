#!/usr/bin/env node
// Real Chromium + unpacked extension + CLI/Bridge acceptance. No desktop or model.
// Pass --playwright=/absolute/path/to/playwright/index.mjs when not installed locally.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webcli-browser-acceptance-'));
const copy = path.join(root, 'webcli');
const extension = path.join(root, 'extension');
const checks = [];
let browser, bridge, server;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const exec = promisify(execFile);
async function unusedPort() {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
async function record(name, value) {
  await fs.writeFile(path.join(root, `${name}.json`), JSON.stringify(value, null, 2));
}
function passed(check) { checks.push(check); console.log(`PASS ${check}`); }
console.log(`Artifacts: ${root}`);
try {
  const playwrightPath = process.argv.find(arg => arg.startsWith('--playwright='))?.slice(13);
  const executablePath = process.argv.find(arg => arg.startsWith('--chromium='))?.slice(11);
  const { chromium } = await import(playwrightPath ? pathToFileURL(playwrightPath).href : 'playwright');
  await fs.cp(source, copy, { recursive: true, filter: entry => !['node_modules', '__tests__', 'extension', 'adapters', 'e2e-results'].includes(path.basename(entry)) });
  await fs.symlink(path.join(source, 'node_modules'), path.join(copy, 'node_modules'));
  await fs.cp(path.resolve(source, '../weworker/build/extension-dist'), extension, { recursive: true });
  const bridgePort = await unusedPort();
  // Only temporary copies change transport port; production protocol/code stays intact.
  for (const file of [path.join(copy, 'index.js'), path.join(copy, 'bridge.js'), path.join(copy, 'exploration-client.js'), path.join(extension, 'background/service-worker.js')]) {
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replaceAll('3711', String(bridgePort)));
  }
  // Daemon PID/log discovery must also stay away from the user's global service.
  const cliEntry = path.join(copy, 'index.js');
  await fs.writeFile(cliEntry, (await fs.readFile(cliEntry, 'utf8')).replaceAll('homedir()', JSON.stringify(path.join(root, 'cli-config-root'))));
  const env = { ...process.env, WEWORKER_USER_ADAPTERS_DIR: path.join(root, 'user'), WEBCLI_ADAPTERS_DIR: path.join(root, 'user'),
    WEWORKER_ADAPTER_DATA_DIR: path.join(root, 'data'), WEWORKER_BUILTIN_ADAPTERS_DIR: path.join(root, 'builtin'), WEWORKER_BUILD_PROFILE: 'public' };
  delete env.WEWORKER_RESOURCES_PATH;
  await fs.mkdir(env.WEWORKER_BUILTIN_ADAPTERS_DIR);
  await fs.writeFile(path.join(copy, 'acceptance-bridge.mjs'), "import { WebSocketBridge } from './bridge.js'; new WebSocketBridge();\n");
  async function startBridge() {
    const log = await fs.open(path.join(root, 'bridge.log'), 'a');
    bridge = spawn(process.execPath, [path.join(copy, 'acceptance-bridge.mjs')], { env, stdio: ['ignore', log.fd, log.fd] });
    await log.close();
    for (let i = 0; i < 50; i++) {
      const ready = await new Promise(resolve => { const socket = net.connect(bridgePort, '127.0.0.1'); socket.on('connect', () => { socket.destroy(); resolve(true); }); socket.on('error', () => resolve(false)); });
      if (ready) return;
      assert.equal(bridge.exitCode, null, 'Bridge exited during startup');
      await delay(100);
    }
    throw new Error('Bridge did not listen');
  }
  await startBridge();
  async function cli(command, args = {}, expectedOk = true) {
    let result;
    try { result = await exec(process.execPath, [path.join(copy, 'index.js'), 'call', command, '--args', JSON.stringify(args), '--output-format=json'], { env, timeout: 95000, maxBuffer: 3_000_000 }); }
    catch (error) { if (expectedOk) throw error; result = error; }
    const output = JSON.parse(result.stdout);
    if (command.startsWith('exploration.')) assert.equal(output.ok, expectedOk, JSON.stringify(output));
    return output;
  }
  const html = `<!doctype html><title>Example inventory</title><h1>Example inventory</h1>
    <form role="search"><input id="query" type="search" placeholder="Search items" aria-label="Search items"><button type="submit">Search</button></form>
    <button id="next" aria-label="Next page">Next page</button><pre id="items"></pre>
    <script>let page=1; async function load(){const response=await fetch('/api/items?q='+encodeURIComponent(document.querySelector('#query').value)+'&page='+page+'&limit=2');document.querySelector('#items').textContent=JSON.stringify(await response.json());}
    document.querySelector('form').onsubmit=e=>{e.preventDefault();page=1;load()};document.querySelector('#next').onclick=()=>{page++;load()};load();</script>`;
  const apiRequests = [];
  let failApi = false;
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/items') {
      const q = url.searchParams.get('q') || ''; const page = Number(url.searchParams.get('page') || 1);
      apiRequests.push({ q, page });
      const unavailable = failApi || q === 'example-http-error';
      res.writeHead(unavailable ? 503 : 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(unavailable ? { error: 'Example service unavailable' }
        : { data: { items: q === 'example-empty' ? [] : [{ id: `example-${page}`, name: q || 'Example item' }], page, total: 4 } }));
    } else { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launchPersistentContext(path.join(root, 'browser-profile'), { channel: 'chromium', executablePath, headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const page = await browser.newPage();
  await page.goto(origin);
  async function connected() {
    for (let i = 0; i < 30; i++) {
      const caps = await cli('exploration.capabilities');
      if (caps.data.connected) return;
      await delay(500);
    }
    throw new Error('Extension did not connect');
  }
  await connected(); passed('standalone extension connected');
  const tabs = (await cli('exploration.tabs')).data.tabs;
  const tabId = tabs.find(tab => tab.url === origin + '/').id;
  const args = { tabId, goal: '查询示例列表，支持关键词和分页', requestId: 'example-browser-acceptance' };
  const start = await cli('exploration.start', args); const taskId = start.data.taskId;
  assert.equal((await cli('exploration.start', args)).data.taskId, taskId);
  passed('idempotent CLI start');
  async function settle(id = taskId) {
    for (let i = 0; i < 90; i++) {
      const state = (await cli('exploration.get', { taskId: id })).data;
      if (!['collecting', 'validating', 'installing'].includes(state.status)) { await record('latest-state', state); return state; }
      await delay(1000);
    }
    throw new Error('Task did not settle');
  }
  assert.equal((await settle()).status, 'evidence_ready');
  const actions = (await cli('exploration.actions', { taskId })).data;
  await record('actions', actions);
  const search = actions.candidates.find(action => action.kind === 'search');
  assert.ok(search, 'Search control discovered');
  await cli('exploration.probe', { taskId, candidateId: search.id, value: 'Example search' });
  assert.equal((await settle()).status, 'evidence_ready');
  assert.ok(apiRequests.some(request => request.q === 'Example search'));
  passed('safe search probe triggers real API');
  await cli('exploration.collect', { taskId }); await settle();
  const evidence = (await cli('exploration.evidence', { taskId })).data;
  await record('evidence', evidence);
  assert.ok(!JSON.stringify(evidence).includes('Example search'));
  const sourceIndex = evidence.candidates.findIndex(candidate => new URL(candidate.url).pathname === '/api/items');
  assert.ok(sourceIndex >= 0);
  assert.equal(evidence.candidates[sourceIndex].responseHints.listPath, 'data.items');
  passed('capture and collect preserve structure without values');
  const generated = await cli('exploration.generate', { taskId, plan: { tools: [{ name: 'search_items', purpose: '查询示例列表与分页', risk: 'read', sourceApiKind: 'list', sourceApiIndexes: [sourceIndex] }] } });
  await record('generated', generated);
  const files = (await cli('exploration.draft-read', { taskId })).data.files;
  for (const file of files) await record(`draft-${file.replaceAll('/', '_')}`, (await cli('exploration.draft-read', { taskId, file })).data);
  const manifest = (await cli('exploration.draft-read', { taskId, file: 'manifest.json' })).data;
  const stale = await cli('exploration.draft-write', { taskId, file: 'manifest.json', expectedHash: 'stale', content: manifest.content }, false);
  assert.equal(stale.error.code, 'STALE_DRAFT');
  // Exercise the same hash-guarded authoring interface used by any calling agent.
  const authored = JSON.parse(manifest.content); authored.description = 'Example inventory read queries';
  await cli('exploration.draft-write', { taskId, file: 'manifest.json', expectedHash: manifest.hash, content: JSON.stringify(authored, null, 2) + '\n' });
  passed('agent draft read/write and stale hash rejection');
  const moduleFile = authored.commands.find(command => command.id === 'search-items').module;
  const module = (await cli('exploration.draft-read', { taskId, file: moduleFile })).data;
  await cli('exploration.draft-write', { taskId, file: moduleFile, expectedHash: module.hash, content: module.content + '\n{' });
  await cli('exploration.validate', { taskId });
  const failed = await settle();
  assert.equal(failed.status, 'draft'); assert.equal(failed.validation.passed, false);
  const broken = (await cli('exploration.draft-read', { taskId, file: moduleFile })).data;
  const authoredCode = module.content.replace('...{},', 'page: 1, limit: 2,');
  assert.notEqual(authoredCode, module.content);
  await cli('exploration.draft-write', { taskId, file: moduleFile, expectedHash: broken.hash, content: authoredCode });
  passed('invalid JavaScript rejected and repaired through CLI');
  failApi = true;
  await cli('exploration.validate', { taskId });
  const runtimeFailure = await settle(); await record('runtime-failure', runtimeFailure);
  assert.equal(runtimeFailure.status, 'draft');
  assert.equal(runtimeFailure.runtimeValidation.passed, false);
  assert.equal(runtimeFailure.runtimeValidation.executionSummary.failed, 1);
  assert.ok(runtimeFailure.runtimeValidation.errors.length > 0);
  assert.equal((await cli('exploration.review', { taskId }, false)).error.code, 'VALIDATION_REQUIRED');
  failApi = false;
  passed('runtime HTTP failure blocks review until successful revalidation');
  await cli('exploration.validate', { taskId });
  const validated = await settle(); await record('validation', validated);
  assert.equal(validated.status, 'review_ready', JSON.stringify(validated));
  assert.deepEqual(validated.runtimeValidation.executionSummary, { attempted: 1, passed: 1, skipped: 0, failed: 0 });
  passed('real browser preview validation');
  const review = (await cli('exploration.review', { taskId })).data; await record('review', review);
  assert.equal((await cli('exploration.install', { taskId, reviewId: review.reviewId }, false)).error.code, 'CONFIRMATION_REQUIRED');
  assert.equal((await cli('exploration.install', { taskId, reviewId: 'stale', confirmed: true }, false)).error.code, 'STALE_REVIEW');
  await cli('exploration.install', { taskId, reviewId: review.reviewId, confirmed: true });
  assert.equal((await settle()).status, 'installed');
  passed('review-bound installation into isolated adapter root');
  const output = await cli(generated.data.toolNames[0], { q: 'Example final', page: 2, limit: 2 });
  await record('ordinary-call', output);
  assert.ok(apiRequests.some(request => request.q === 'Example final' && request.page === 2), JSON.stringify(output));
  assert.ok(JSON.stringify(output).includes('example-2'), JSON.stringify(output));
  passed('ordinary webcli call executes installed search and pagination');
  const empty = await cli(generated.data.toolNames[0], { q: 'example-empty' });
  assert.equal(empty.ok, true); assert.deepEqual(empty.data.data.items, []);
  const unavailable = await cli(generated.data.toolNames[0], { q: 'example-http-error' }, false);
  assert.equal(unavailable.ok, false); assert.equal(unavailable.status, 503);
  passed('ordinary calls handle empty data and HTTP errors');
  const events = (await cli('exploration.events', { taskId, cursor: 0 })).data;
  assert.ok(events.events.some(event => event.status === 'installed'));
  passed('persisted event history');
  const incrementalId = (await cli('exploration.start', { ...args, requestId: 'example-incremental' })).data.taskId;
  assert.equal((await settle(incrementalId)).status, 'evidence_ready');
  const incrementalEvidence = (await cli('exploration.evidence', { taskId: incrementalId })).data;
  const incrementalIndex = incrementalEvidence.candidates.findIndex(candidate => new URL(candidate.url).pathname === '/api/items');
  const incremental = await cli('exploration.generate', { taskId: incrementalId, plan: { tools: [{ name: 'list_items', purpose: '列出示例项目', risk: 'read', sourceApiKind: 'list', sourceApiIndexes: [incrementalIndex] }] } });
  assert.equal((await cli('exploration.draft-read', { taskId: incrementalId, file: moduleFile })).data.content, authoredCode);
  await cli('exploration.validate', { taskId: incrementalId });
  const incrementalValidation = await settle(incrementalId);
  assert.equal(incrementalValidation.status, 'review_ready', JSON.stringify(incrementalValidation));
  assert.deepEqual(incrementalValidation.runtimeValidation.executionSummary, { attempted: 1, passed: 1, skipped: 0, failed: 0 });
  const incrementalReview = (await cli('exploration.review', { taskId: incrementalId })).data;
  assert.ok(incrementalReview.currentVersion);
  await cli('exploration.install', { taskId: incrementalId, reviewId: incrementalReview.reviewId, confirmed: true });
  assert.equal((await settle(incrementalId)).status, 'installed');
  assert.equal((await cli(generated.data.toolNames[0], { q: 'Example retained', page: 2 })).ok, true);
  assert.equal((await cli(incremental.data.toolNames[0], { page: 1 })).ok, true);
  passed('incremental generation preserves authored tool and both installed commands run');

  const cancelledId = (await cli('exploration.start', { ...args, requestId: 'example-cancel' })).data.taskId;
  await cli('exploration.cancel', { taskId: cancelledId });
  await delay(5000);
  const cancelled = (await cli('exploration.get', { taskId: cancelledId })).data;
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.candidateCount, 0);
  passed('cancel discards late real browser capture');

  const interruptedId = (await cli('exploration.start', { ...args, requestId: 'example-restart' })).data.taskId;
  const exited = new Promise(resolve => bridge.once('exit', resolve)); bridge.kill('SIGTERM'); await exited;
  await startBridge(); await connected();
  assert.equal((await cli('exploration.get', { taskId: interruptedId })).data.status, 'interrupted');
  assert.equal((await cli('exploration.start', { ...args, requestId: 'example-restart' })).data.taskId, interruptedId);
  assert.equal((await cli('exploration.get', { taskId })).data.status, 'installed');
  assert.equal((await cli('exploration.get', { taskId: cancelledId })).data.status, 'cancelled');
  // Allow the extension's already-dispatched capture to finish before explicit resumption.
  await delay(5000);
  await cli('exploration.collect', { taskId: interruptedId });
  assert.equal((await settle(interruptedId)).status, 'evidence_ready');
  assert.equal((await cli(generated.data.toolNames[0], { page: 2 })).ok, true);
  passed('Bridge restart restores tasks, marks interruption and permits explicit resumption');
} catch (error) {
  await record('failure', { message: error.message, stack: error.stack });
  console.error(error); process.exitCode = 1;
} finally {
  await browser?.close();
  if (bridge && bridge.exitCode === null && bridge.signalCode === null) { const exited = new Promise(resolve => bridge.once('exit', resolve)); bridge.kill('SIGTERM'); await exited; }
  if (server) await new Promise(resolve => server.close(resolve));
  await record('report', { passed: !process.exitCode, checks, artifacts: root });
}
