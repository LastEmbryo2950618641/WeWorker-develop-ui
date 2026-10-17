import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { explorationCommands, explorationHelp, explorationError as fail, integerArg, textArg } from './exploration-commands.js';
import { extractExplorationEvidence, structuralUrl } from './exploration-evidence.js';
import { resolveAdapterPaths } from './paths.js';
import { assertManagedDirectory, assertManagedFile, readPackageDirectory } from './adapter-package-files.js';
import { writeAdapterPackageFromSiteMemory } from './adapter-scaffold.js';
import { buildQuickGenerationPlan } from './generation-harness/quick-generation.js';
import { prepareGenerationRun, allocateGenerationPlan, verifyRetainedPackage } from './generation-harness/existing-site.js';
import { readGenerationEvidence } from './generation-harness/package-inspection.js';
import { validateAdapterDraft } from './generation-harness/static-validator.js';
import { createPreviewRuntimeValidator } from './generation-harness/runtime-validator.js';
import { describeGeneratedInstall } from './generation-harness/install-review.js';
import { createAdapterPublisher } from './generation-harness/adapter-publisher.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const active = new Set(['collecting', 'validating', 'installing']);
const terminal = new Set(['cancelled', 'installed']);
const clone = value => JSON.parse(JSON.stringify(value));

/** Owned by the existing Bridge. No desktop Backend, Python, or model credentials. */
export class ExplorationService {
  constructor({ rootDir, paths, requestExtension, capabilities = () => ({ connected: false, capabilities: [] }),
    runtimeValidator, publisher } = {}) {
    this.paths = paths || resolveAdapterPaths();
    this.root = rootDir || path.join(this.paths.workspaceDir, 'exploration');
    assertManagedDirectory(this.root);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.request = requestExtension;
    this.capabilities = capabilities;
    this.runtimeValidator = runtimeValidator || createPreviewRuntimeValidator({ requestExtension, restrictToExpectedTools: true });
    this.publisher = publisher || createAdapterPublisher({ paths: this.paths });
    this.runs = new Map();
    this.controllers = new Map();
    this.jobs = new Map();
    this.starting = new Map();
    for (const name of fs.readdirSync(this.root)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const run = JSON.parse(fs.readFileSync(assertManagedFile(this.root, name), 'utf8'));
      if (run.schemaVersion !== 1 || `${run.taskId}.json` !== name) throw fail('STORE_INVALID', 'Invalid exploration task store.');
      this.runs.set(run.taskId, run);
      if (active.has(run.status)) this.update(run, 'interrupted', 'Bridge restarted; collect or validate again explicitly.');
    }
  }

  save(run) {
    const file = assertManagedFile(this.root, `${run.taskId}.json`);
    const temp = assertManagedFile(this.root, `${run.taskId}.json.tmp`);
    fs.writeFileSync(temp, JSON.stringify(run), { mode: 0o600 });
    fs.renameSync(temp, file);
  }

  update(run, status, message) {
    run.status = status;
    run.updatedAt = new Date().toISOString();
    run.sequence = (run.sequence || 0) + 1;
    run.events.push({ cursor: run.sequence, at: run.updatedAt, status, message });
    run.events = run.events.slice(-200);
    this.save(run);
  }

  summary(run) {
    const next = { collecting: ['get', 'cancel'], evidence_ready: ['evidence', 'actions', 'probe', 'generate', 'collect'], draft: ['draft-read', 'draft-write', 'validate'],
      validating: ['get', 'cancel'], installing: ['get'], review_ready: ['review', 'install'], failed: ['evidence', 'collect', 'draft-read', 'validate'], interrupted: ['get', 'collect', 'validate'] };
    return { taskId: run.taskId, status: run.status, goal: run.goal, tabId: run.tabId, site: run.origin,
      createdAt: run.createdAt, updatedAt: run.updatedAt, candidateCount: run.candidates.length,
      toolNames: run.draft?.toolNames || [], validation: run.validation || null, runtimeValidation: run.runtimeSummary || null,
      error: run.error || null, nextActions: (next[run.status] || []).map(name => `exploration.${name}`) };
  }

  async execute(command, args = {}) {
    try {
      if (!Object.hasOwn(explorationCommands, command)) throw fail('UNKNOWN_COMMAND', 'Use webcli call exploration.help.');
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw fail('INVALID_ARGUMENT', 'Arguments must be an object.');
      const allowed = explorationCommands[command].params.map(name => name.replace(/\?$/, ''));
      for (const name of Object.keys(args)) if (!allowed.includes(name)) throw fail('INVALID_ARGUMENT', `Unknown argument: ${name}`);
      return { schemaVersion: 1, ok: true, command: `exploration.${command}`, data: await this.dispatch(command, args) };
    } catch (error) {
      return { schemaVersion: 1, ok: false, command: `exploration.${command}`, error: { code: error.code || 'EXPLORATION_FAILED', message: this.safeError(error) } };
    }
  }

  safeError(error) {
    // Browser/model messages may contain captured data. Only our typed messages
    // and static/package validation summaries are returned to the caller.
    return error.code && /^[A-Z_]+$/.test(error.code) ? String(error.message).replaceAll(this.root, '<workspace>').slice(0, 500) : 'Operation failed. Check task state, extension connection and draft validation.';
  }

  async tabs() {
    if (!this.capabilities().connected) throw fail('EXTENSION_UNAVAILABLE', 'Connect the WeWorker browser extension.');
    const result = await this.request({ type: 'exploration_list_tabs' }, 15000);
    return (result.tabs || []).flatMap(tab => {
      try { return [{ id: tab.id, url: structuralUrl(tab.url), active: Boolean(tab.active) }]; } catch { return []; }
    });
  }

  async checkTab(run) {
    const tab = (await this.tabs()).find(tab => tab.id === run.tabId);
    if (!tab || new URL(tab.url).origin !== run.origin) throw fail('TAB_CHANGED', 'The task tab is closed or belongs to a different origin. Select the intended page before continuing.');
    return tab;
  }

  launch(run, status, fn) {
    run.error = null;
    const controller = new AbortController();
    this.controllers.set(run.taskId, controller);
    this.update(run, status, status);
    const job = Promise.resolve().then(() => fn(controller.signal)).catch(error => {
      if (controller.signal.aborted) return;
      run.error = { code: error.code || 'EXPLORATION_FAILED', message: this.safeError(error) };
      this.update(run, 'failed', run.error.message);
    }).finally(() => { this.controllers.delete(run.taskId); this.jobs.delete(run.taskId); });
    this.jobs.set(run.taskId, job);
    return this.summary(run);
  }

  async dispatch(command, args) {
    if (command === 'help') return explorationHelp();
    if (command === 'capabilities') return { ...this.capabilities(), desktopRequired: false, modelRequired: false, author: 'calling-agent', schemaVersion: 1 };
    if (command === 'tabs') return { tabs: await this.tabs() };
    if (command === 'list') return { tasks: [...this.runs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(run => this.summary(run)) };
    if (command === 'start') {
      const requestId = textArg(args.requestId, 'requestId', 100);
      const goal = textArg(args.goal, 'goal');
      const tabId = integerArg(args.tabId, 'tabId');
      const signature = hash(JSON.stringify({ goal, tabId }));
      const previous = [...this.runs.values()].find(run => run.requestId === requestId);
      if (previous) {
        if (previous.signature !== signature) throw fail('REQUEST_CONFLICT', 'requestId was already used with different arguments.');
        return this.summary(previous);
      }
      if (this.starting.has(requestId)) {
        const pending = this.starting.get(requestId);
        if (pending.signature !== signature) throw fail('REQUEST_CONFLICT', 'requestId is in use.');
        return pending.promise;
      }
      const promise = this.start({ requestId, goal, tabId, signature });
      this.starting.set(requestId, { signature, promise });
      try { return await promise; } finally { this.starting.delete(requestId); }
    }
    const taskId = textArg(args.taskId, 'taskId', 100);
    const run = this.runs.get(taskId);
    if (!run) throw fail('TASK_NOT_FOUND', 'Task not found; use exploration.list.');
    if (command === 'get') return this.summary(run);
    if (command === 'events') {
      const cursor = integerArg(args.cursor, 'cursor', 0);
      return { taskId, events: run.events.filter(event => event.cursor > cursor), cursor: run.sequence, truncated: cursor < (run.events[0]?.cursor || 1) - 1 };
    }
    if (command === 'evidence') return { taskId, candidates: clone(run.candidates), policy: 'same-origin structure only; captured scalar values omitted' };
    if (command === 'cancel') {
      if (terminal.has(run.status)) return this.summary(run);
      if (run.status === 'installing') throw fail('INVALID_STATE', 'Installation has started; inspect its outcome before making another change.');
      this.controllers.get(taskId)?.abort();
      this.update(run, 'cancelled', 'Task cancelled; late browser results will be discarded.');
      return this.summary(run);
    }
    if (command === 'install' && run.status === 'installed') return this.summary(run);
    if (active.has(run.status)) throw fail('TASK_BUSY', 'Wait for the current operation or cancel the task.');
    if (terminal.has(run.status)) throw fail('INVALID_STATE', 'This task is terminal. Start a new task.');
    if (['collect', 'actions', 'probe'].includes(command)) {
      if (run.draft) throw fail('INVALID_STATE', 'Start a new task to change source evidence after drafting.');
    }
    if (command === 'actions') {
      await this.checkTab(run);
      if (active.has(run.status) || terminal.has(run.status) || run.draft) throw fail('INVALID_STATE', 'Task state changed.');
      if (!this.capabilities().capabilities.includes('safe_api_probe_v1')) throw fail('CAPABILITY_UNAVAILABLE', 'Reload the extension to enable safe API probes.');
      const result = await this.request({ type: 'exploration_safe_actions_inspect', tabId: run.tabId }, 15000);
      await this.checkTab(run);
      if (active.has(run.status) || terminal.has(run.status) || run.draft) throw fail('INVALID_STATE', 'Task state changed.');
      run.actions = (result.candidates || []).filter(item => item.risk === 'read' && ['search', 'filter', 'pagination'].includes(item.kind))
        .map(item => ({ id: String(item.id), kind: item.kind, requiresValue: item.requiresValue === true, risk: 'read' }));
      this.save(run);
      return { taskId, candidates: run.actions, remainingProbes: Math.max(0, 3 - (run.probeCount || 0)) };
    }
    if (command === 'probe') {
      if ((run.probeCount || 0) >= 3) throw fail('PROBE_LIMIT', 'Three safe probes have been used. Review evidence before starting another task.');
      const candidateId = textArg(args.candidateId, 'candidateId', 200);
      const action = run.actions?.find(item => item.id === candidateId);
      if (!action) throw fail('STALE_ACTION', 'Inspect exploration.actions before probing.');
      if (action.requiresValue) textArg(args.value, 'value', 80);
      if (args.value !== undefined && (typeof args.value !== 'string' || args.value.length > 80)) throw fail('INVALID_ARGUMENT', 'value must contain at most 80 characters.');
      run.probeCount = (run.probeCount || 0) + 1;
      run.actions = [];
      return this.collect(run, false, { type: 'exploration_safe_probe_run', candidateId, value: args.value || '' });
    }
    if (command === 'collect') {
      return this.collect(run, false);
    }
    if (command === 'generate') return this.generate(run, args.plan);
    if (!run.draft) throw fail('INVALID_STATE', 'Generate a draft first.');
    if (command === 'draft-read') {
      if (args.file === undefined) return { files: run.draftFiles };
      const file = textArg(args.file, 'file', 200);
      if (!run.draftFiles.includes(file)) throw fail('INVALID_ARGUMENT', 'File is not in this draft.');
      const content = fs.readFileSync(assertManagedFile(run.draft.adapterDir, file));
      return { file: args.file, content: content.toString('utf8'), hash: hash(content) };
    }
    if (command === 'draft-write') {
      const file = textArg(args.file, 'file', 200);
      if (!run.draftFiles.includes(file)) throw fail('INVALID_ARGUMENT', 'Only existing draft files can be edited.');
      const prior = fs.readFileSync(assertManagedFile(run.draft.adapterDir, file));
      if (args.expectedHash !== hash(prior)) throw fail('STALE_DRAFT', 'File changed; read it again before editing.');
      if (typeof args.content !== 'string' || args.content.length > 250000) throw fail('INVALID_ARGUMENT', 'content must be a string of at most 250000 characters.');
      fs.writeFileSync(assertManagedFile(run.draft.adapterDir, file), args.content, 'utf8');
      run.validation = null; run.runtimeSummary = null; run.runtimeDigest = null; run.review = null;
      this.update(run, 'draft', 'Draft edited; validate again.');
      return { file, hash: hash(args.content) };
    }
    if (command === 'validate') return this.validate(run);
    if (command === 'review') {
      this.assertValidated(run);
      run.review = describeGeneratedInstall(run.draft, { paths: this.paths });
      this.save(run);
      return { ...run.review, tools: readPackageDirectory(run.draft.adapterDir).manifest.commands };
    }
    if (command === 'install') {
      this.assertValidated(run);
      if (args.confirmed !== true && args.confirmed !== 'true') throw fail('CONFIRMATION_REQUIRED', 'Obtain explicit user consent to the current installation review.');
      const review = describeGeneratedInstall(run.draft, { paths: this.paths });
      if (!run.review || args.reviewId !== run.review.reviewId || args.reviewId !== review.reviewId) throw fail('STALE_REVIEW', 'Run exploration.review and obtain consent to that exact review.');
      // Lock before awaiting publisher; concurrent edits/installs must not race.
      return this.launch(run, 'installing', async signal => {
        if (signal.aborted) return;
        const result = await this.publisher({ run: this.facade(run), store: {}, approval: { reviewId: review.reviewId, acceptChanges: true } });
        // Installation is atomic and cannot be undone by a late cancel.
        run.installed = { digest: result.digest, version: result.version };
        this.update(run, 'installed', 'Adapter installed locally.');
      });
    }
  }

  async start({ requestId, goal, tabId, signature }) {
    if (this.runs.size >= 200) throw fail('TASK_LIMIT', 'Exploration task limit reached; archive task data before creating more.');
    const caps = this.capabilities();
    if (!caps.capabilities.includes('passive_exploration_v1')) throw fail('CAPABILITY_UNAVAILABLE', 'Reload the extension to enable passive API exploration.');
    const tab = (await this.tabs()).find(tab => tab.id === tabId);
    if (!tab) throw fail('TAB_CHANGED', 'Select a tab from exploration.tabs.');
    this.assertTabAvailable(tabId);
    const now = new Date().toISOString();
    const run = { schemaVersion: 1, taskId: randomUUID(), requestId, signature, goal, tabId, origin: new URL(tab.url).origin,
      siteKey: new URL(tab.url).hostname, createdAt: now, updatedAt: now, status: 'created', candidates: [], events: [], sequence: 0 };
    this.runs.set(run.taskId, run);
    return this.collect(run, true);
  }

  collect(run, reload, probe) {
    this.assertTabAvailable(run.tabId, run.taskId);
    return this.launch(run, 'collecting', async signal => {
      await this.checkTab(run);
      if (signal.aborted) return;
      const capture = await this.request({ ...(probe || { type: reload ? 'exploration_capture_passive' : 'browser_network' }), tabId: run.tabId }, 90000);
      if (signal.aborted) return;
      await this.checkTab(run);
      if (signal.aborted) return;
      const found = extractExplorationEvidence(capture, run.origin);
      run.candidates = [...new Map([...run.candidates, ...found].map(item => [item.id, item])).values()].slice(-100);
      this.update(run, 'evidence_ready', found.length ? 'Structural evidence collected; calling agent may select APIs.' : 'No usable same-origin evidence; interact with the page and collect again.');
    });
  }

  generate(run, proposedPlan) {
    if (run.draft) return this.summary(run); // Repeated generation never overwrites an authored draft.
    const candidates = run.candidates.filter(item => item.method === 'GET' && !new URL(item.url).pathname.includes(':id')
      && item.risk.level === 'read' && item.status >= 200 && item.status < 300);
    if (!candidates.length) throw fail('NO_READ_EVIDENCE', 'Collect a successful same-origin GET query before generating.');
    // Keep original evidence indexes stable for agent-authored plans.
    run.memory = { siteKey: run.siteKey, siteHost: new URL(run.origin).hostname, siteOrigin: run.origin, canonicalEntryUrl: run.origin + '/',
      listApiCandidates: run.candidates.map(item => clone(item)), actionApiCandidates: [] };
    const facade = this.facade(run);
    prepareGenerationRun(facade, { paths: this.paths });
    run.siteKey = facade.snapshot.siteKey; run.memory = facade.snapshot.input.memory;
    const plan = proposedPlan || buildQuickGenerationPlan({ ...run.memory, listApiCandidates: run.memory.listApiCandidates.map(item => candidates.some(candidate => candidate.id === item.id) ? item : { ...item, url: '' }) });
    if (!Array.isArray(plan.tools) || !plan.tools.length || plan.tools.length > 2) throw fail('INVALID_PLAN', 'Provide one or two read tools.');
    for (const tool of plan.tools) {
      const candidate = run.candidates[tool.sourceApiIndexes?.[0]];
      if (tool.risk !== 'read' || tool.sourceApiKind !== 'list' || !candidate || !candidates.some(item => item.id === candidate.id)) throw fail('INVALID_PLAN', 'Each tool must reference a successful observed read-only GET candidate by index.');
    }
    run.plan = allocateGenerationPlan(run.memory, plan);
    const outputRoot = path.join(this.root, run.taskId, randomUUID());
    const draft = writeAdapterPackageFromSiteMemory(run.memory, { outputRoot, plan: run.plan, adapterPaths: this.paths });
    run.draft = { ...draft, toolNames: run.plan.tools.map(tool => `${run.siteKey}.${tool.name.replace(/_/g, '-')}`) };
    run.draftFiles = [...readPackageDirectory(run.draft.adapterDir).files.keys()];
    this.update(run, 'draft', 'Draft created. Inspect and edit it, then validate. No model was called.');
    return this.summary(run);
  }

  facade(run) {
    return { id: run.taskId, snapshot: { siteKey: run.siteKey, input: { tabId: run.tabId, memory: run.memory },
      artifacts: { draft: run.draft, staticValidation: run.validation } }, setArtifact() {} };
  }

  assertTabAvailable(tabId, taskId) {
    if ([...this.controllers.keys()].some(id => id !== taskId && this.runs.get(id)?.tabId === tabId)) {
      throw fail('TAB_BUSY', 'Another task still owns an in-flight operation on this tab. Wait for it to settle.');
    }
  }

  assertReadDraft(run) {
    const pkg = readPackageDirectory(run.draft.adapterDir);
    const retained = verifyRetainedPackage(pkg, readGenerationEvidence(run.draft.adapterDir), { paths: this.paths });
    if (pkg.manifest.commands.some(command => !retained.has(command.id) && (command.safety !== 'read' || command.runtime !== 'extension'))) throw fail('READ_ONLY_REQUIRED', 'This standalone workflow only validates new read-only Extension commands.');
    return pkg;
  }

  validate(run) {
    this.assertTabAvailable(run.tabId, run.taskId);
    run.review = null; run.runtimeDigest = null; run.runtimeSummary = null;
    return this.launch(run, 'validating', async signal => {
      await this.checkTab(run);
      if (signal.aborted) return;
      run.validation = validateAdapterDraft({ adapterDir: run.draft.adapterDir, expectedSiteKey: run.siteKey, expectedToolNames: run.draft.toolNames });
      if (!run.validation.passed) { this.update(run, 'draft', 'Static validation failed; inspect validation errors.'); return; }
      this.assertReadDraft(run);
      const runtime = await this.runtimeValidator({ run: this.facade(run), draft: run.draft, signal, plan: run.plan, memory: run.memory, validation: run.validation });
      if (signal.aborted) return;
      await this.checkTab(run);
      if (signal.aborted) return;
      // Persist only verifier summaries, never observed result bodies/test inputs.
      const counts = runtime.executionSummary;
      run.runtimeSummary = { passed: runtime.passed === true, executionSummary: counts ? { attempted: counts.attempted, passed: counts.passed, skipped: counts.skipped, failed: counts.failed } : null,
        errors: (runtime.errors || []).slice(0, 20).map(error => ({ code: String(error.code || 'VALIDATION_FAILED') })) };
      const count = run.draft.toolNames.length;
      if (!runtime.passed || !counts || counts.attempted !== count || counts.passed !== count || counts.skipped !== 0 || counts.failed !== 0) {
        this.update(run, 'draft', 'Runtime validation incomplete; repair the draft or page state and validate again.'); return;
      }
      if (readPackageDirectory(run.draft.adapterDir).digest !== run.validation.packageDigest) throw fail('STALE_DRAFT', 'Draft changed during verification.');
      run.runtimeDigest = run.validation.packageDigest;
      this.update(run, 'review_ready', 'Read tools passed validation. Review before installation.');
    });
  }

  assertValidated(run) {
    const pkg = this.assertReadDraft(run);
    if (run.status !== 'review_ready' || !run.validation?.passed || run.runtimeDigest !== pkg.digest) throw fail('VALIDATION_REQUIRED', 'Validate the current draft before review or installation.');
  }
}
