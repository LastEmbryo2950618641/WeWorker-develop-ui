import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../sidepanel/sidepanel.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('async function publishGenerationRun()'), source.indexOf('function clearActionCapturePolling()'));

for (const accepted of [false, true]) {
  for (const status of ['awaiting_approval', 'completed']) {
    test(`installation consent=${accepted}, response=${status}`, async () => {
      const calls = [], removed = [], refreshed = [];
      const review = { reviewId: 'fixture-review' };
      const context = vm.createContext({
        activeGenerationRunId: 'fixture-run', currentSiteKey: 'example.com', activeInstallationReview: review,
        confirm: () => accepted, clearGenerationPolling() {}, renderGenerationRun() {}, setDevWorkflowStep() {},
        removeGenerationRunId: (...args) => removed.push(args), refreshCurrentTabState: () => refreshed.push(true),
        chrome: { runtime: { sendMessage: async message => { calls.push(message); return { ok: true, run: { status } }; } } },
      });
      vm.runInContext(body, context);
      await context.publishGenerationRun();
      assert.equal(calls.length, accepted ? 1 : 0);
      if (accepted) assert.deepEqual(JSON.parse(JSON.stringify(calls[0].approval)), { reviewId: review.reviewId, acceptChanges: true });
      assert.equal(removed.length, accepted && status === 'completed' ? 1 : 0);
      assert.equal(refreshed.length, accepted && status === 'completed' ? 1 : 0);
    });
  }
}

test('popup preserves the tracked quick run for sidepanel restoration', async () => {
  const popup = readFileSync(new URL('../popup/popup.js', import.meta.url), 'utf8');
  const start = popup.indexOf('async function triggerGenerate()');
  const end = popup.indexOf('// ── Main', start);
  const elements = new Map();
  const messages = [], storage = [], opened = [];
  const context = vm.createContext({ URL, escHtml: value => value,
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); } },
    chrome: {
      tabs: { query: async () => [{ id: 7, url: 'https://example.com/' }] },
      runtime: { sendMessage: async message => { messages.push(message); return { ok: true, run: { id: 'draft' } }; } },
      storage: { local: { get: async () => ({ generationRunsBySite: { 'example.org': 'previous' } }), set: async value => storage.push(value) } },
      sidePanel: { open: args => opened.push(args) },
    },
  });
  vm.runInContext(popup.slice(start, end), context);
  await context.triggerGenerate();
  assert.equal(messages[0].type, 'popup_explore_generate_scaffold');
  assert.deepEqual(JSON.parse(JSON.stringify(storage[0])), { generationRunsBySite: { 'example.org': 'previous', 'example.com': 'draft' } });
  elements.get('openGenerationReview').onclick();
  assert.equal(opened[0].tabId, 7);
});
