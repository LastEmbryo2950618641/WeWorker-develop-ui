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
import { TabOperationLocks } from './tab-operation-locks.js';
import { normalizeVerificationCases } from './exploration-verification.js';
import { ExplorationKnowledge } from './exploration-knowledge.js';
import { buildAdapterCatalog } from './adapter-catalog.js';
import { repairTarget, writeRepairDraft } from './exploration-repair.js';
import { normalizePageSource, pageObservation, buildPageTool } from './exploration-page.js';
import { writePackageDraft } from './generation-harness/package-draft.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const active = new Set(['collecting', 'validating', 'installing']);
const terminal = new Set(['cancelled', 'installed']);
const clone = value => JSON.parse(JSON.stringify(value));

/** Owned by the existing Bridge. No desktop Backend, Python, or model credentials. */
export class ExplorationService {
  constructor({ rootDir, paths, requestExtension, capabilities = () => ({ connected: false, capabilities: [] }),
    runtimeValidator, publisher, tabLocks = new TabOperationLocks() } = {}) {
    this.paths = paths || resolveAdapterPaths();
    this.root = rootDir || path.join(this.paths.workspaceDir, 'exploration');
    assertManagedDirectory(this.root);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.knowledge = new ExplorationKnowledge(path.join(this.root, 'knowledge'));
    this.request = requestExtension;
    this.tabLocks = tabLocks;
    this.capabilities = capabilities;
    this.runtimeValidator = runtimeValidator || createPreviewRuntimeValidator({ requestExtension, restrictToExpectedTools: true, paths: this.paths });
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
    const next = { collecting: ['get', 'cancel'], evidence_ready: ['evidence', 'actions', 'probe', 'observe', 'generate', 'repair-info', 'repair', 'collect'], draft: ['draft-read', 'draft-write', 'verification-read', 'verification-write', 'validate'],
      validating: ['get', 'cancel'], installing: ['get'], review_ready: ['review', 'install'], failed: ['evidence', 'collect', 'draft-read', 'validate'], interrupted: ['get', 'collect', 'validate'] };
    return { taskId: run.taskId, status: run.status, goal: run.goal, tabId: run.tabId, site: run.origin, adapter: run.siteKey,
      createdAt: run.createdAt, updatedAt: run.updatedAt, candidateCount: run.candidates.length,
      pageSourceCount: run.pageSources?.length || 0,
      toolNames: run.draft?.toolNames || [], validation: run.validation || null, runtimeValidation: run.runtimeSummary || null,
      ...(run.repairScope ? { repair: { ...run.repairScope, editableFiles: run.editableFiles, knowledge: run.repairKnowledge } } : {}),
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
    const release = this.tabLocks.acquire(run.tabId);
    run.error = null;
    const controller = new AbortController();
    this.controllers.set(run.taskId, controller);
    try { this.update(run, status, status); }
    catch (error) { this.controllers.delete(run.taskId); release(); throw error; }
    const job = Promise.resolve().then(() => fn(controller.signal)).catch(error => {
      if (controller.signal.aborted) return;
      run.error = { code: error.code || 'EXPLORATION_FAILED', message: this.safeError(error) };
      this.update(run, 'failed', run.error.message);
    }).finally(() => { this.controllers.delete(run.taskId); this.jobs.delete(run.taskId); release(); });
    this.jobs.set(run.taskId, job);
    return this.summary(run);
  }

  async dispatch(command, args) {
    if (command === 'help') return explorationHelp();
    if (command === 'capabilities') return { ...this.capabilities(), desktopRequired: false, modelRequired: false, author: 'calling-agent', schemaVersion: 1 };
    if (command === 'tabs') return { tabs: await this.tabs() };
    if (command === 'list') return { tasks: [...this.runs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(run => this.summary(run)) };
    if (command === 'repair-info') {
      const { target, pkg } = repairTarget(args.site, this.paths);
      return { site: pkg.name, digest: pkg.digest, version: pkg.manifest.version, source: target.source, commands: pkg.manifest.commands,
        knowledge: this.knowledge.read(pkg.name, { activeDigest: pkg.digest }) };
    }
    if (command === 'knowledge-read') {
      const site = textArg(args.site, 'site', 128);
      const activePackage = buildAdapterCatalog({ paths: this.paths }).effective.find(item => item.name === site);
      return this.knowledge.read(site, { activeDigest: activePackage?.digest || null });
    }
    if (command === 'start') {
      const requestId = textArg(args.requestId, 'requestId', 100);
      const goal = textArg(args.goal, 'goal');
      const tabId = integerArg(args.tabId, 'tabId');
      const allowedOrigins = args.allowedOrigins === undefined ? [] : args.allowedOrigins;
      if (!Array.isArray(allowedOrigins) || allowedOrigins.length > 20) throw fail('INVALID_ARGUMENT', 'allowedOrigins must be an array of at most 20 HTTP(S) origins.');
      const origins = [...new Set(allowedOrigins.map(value => {
        try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== value) throw new Error(); return url.origin; }
        catch { throw fail('INVALID_ARGUMENT', 'Each allowedOrigins entry must be an exact HTTP(S) origin without a path or credentials.'); }
      }))].sort();
      // Preserve request signatures for existing same-origin tasks.
      const signature = hash(JSON.stringify({ goal, tabId, ...(origins.length ? { allowedOrigins: origins } : {}) }));
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
      const promise = this.start({ requestId, goal, tabId, signature, allowedOrigins: origins });
      this.starting.set(requestId, { signature, promise });
      try { return await promise; } finally { this.starting.delete(requestId); }
    }
    const taskId = textArg(args.taskId, 'taskId', 100);
    const run = this.runs.get(taskId);
    if (!run) throw fail('TASK_NOT_FOUND', 'Task not found; use exploration.list.');
    if (command === 'get') return this.summary(run);
    if (command === 'knowledge-save') {
      if (!['review_ready', 'installed'].includes(run.status) || !run.runtimeDigest || readPackageDirectory(run.draft.adapterDir).digest !== run.runtimeDigest) throw fail('VALIDATION_REQUIRED', 'Knowledge requires a successfully validated current draft.');
      const indexes = [...new Set((run.plan?.tools || []).flatMap(tool => tool.sourceApiIndexes || []))];
      const endpoints = indexes.map(index => clone(run.candidates[index])).filter(Boolean);
      const pageIds = new Set((run.plan?.tools || []).map(tool => tool.sourcePageId).filter(Boolean));
      const pages = (run.pageSources || []).filter(item => pageIds.has(item.id)).map(clone);
      const verifiedAt = run.verifiedAt || run.updatedAt;
      const commands = Object.fromEntries(run.draft.toolNames.map(tool => [tool, { verifiedAt, packageDigest: run.runtimeDigest,
        cases: clone(run.verification?.[tool] || []) }]));
      return this.knowledge.save(run.siteKey, { expectedHash: args.expectedHash, verifiedAt, packageDigest: run.runtimeDigest,
        endpoints, pages, commands, notes: args.notes, fields: args.fields });
    }
    if (command === 'trace') return { ...this.summary(run), events: clone(run.events),
      evidence: run.candidates.map(({ id, url, method, status, risk, requestSemantics }) => ({ id, url, method, status, risk, requestSemantics })),
      pageSources: clone(run.pageSources || []),
      plannedTools: (run.plan?.tools || []).map(({ name, risk, sourceApiKind, sourceApiIndexes, strategy, sourcePageId }) => ({ name, risk, sourceApiKind, sourceApiIndexes, strategy, sourcePageId })),
      files: run.draftFiles || [], structuralOnly: true };
    if (command === 'events') {
      const cursor = integerArg(args.cursor, 'cursor', 0);
      return { taskId, events: run.events.filter(event => event.cursor > cursor), cursor: run.sequence, truncated: cursor < (run.events[0]?.cursor || 1) - 1 };
    }
    if (command === 'evidence') return { taskId, candidates: clone(run.candidates), pageSources: clone(run.pageSources || []), allowedOrigins: run.allowedOrigins || [], policy: 'page origin and explicitly allowed API origins; structure only; captured scalar values omitted' };
    if (command === 'cancel') {
      if (terminal.has(run.status)) return this.summary(run);
      if (run.status === 'installing') throw fail('INVALID_STATE', 'Installation has started; inspect its outcome before making another change.');
      this.controllers.get(taskId)?.abort();
      this.update(run, 'cancelled', 'Task cancelled; late browser results will be discarded.');
      return this.summary(run);
    }
    if (command === 'install' && run.status === 'installed') return this.summary(run);
    if (active.has(run.status)) throw fail('TASK_BUSY', 'Wait for the current operation or cancel the task.');
    if (terminal.has(run.status) && !['draft-read', 'verification-read'].includes(command)) throw fail('INVALID_STATE', 'This task is terminal. Start a new task.');
    if (['collect', 'actions', 'probe', 'observe'].includes(command)) {
      if (run.draft) throw fail('INVALID_STATE', 'Start a new task to change source evidence after drafting.');
    }
    if (command === 'observe') {
      if (!this.capabilities().capabilities.includes('page_sources_v1')) throw fail('CAPABILITY_UNAVAILABLE', 'Reload the extension to observe page sources.');
      const source = normalizePageSource(args.source), reason = textArg(args.reason, 'reason');
      return this.launch(run, 'collecting', async signal => {
        const tab = await this.checkTab(run);
        if (signal.aborted) return;
        const page = new URL(tab.url);
        const result = await this.request({ type: 'exploration_observe_page', tabId: run.tabId,
          payload: { source, expectedOrigin: page.origin, expectedPath: page.pathname } }, 30000);
        if (signal.aborted) return;
        if (!result?.ok) throw fail(result?.error?.code || 'PAGE_SOURCE_MISSING', result?.error?.message || 'Unable to observe the page source.');
        const current = await this.checkTab(run);
        if (signal.aborted) return;
        if (new URL(current.url).pathname !== page.pathname) throw fail('TAB_CHANGED', 'Page route changed during observation.');
        const observed = pageObservation({ source, url: tab.url, shape: result.shape, reason });
        run.pageSources = [...new Map([...(run.pageSources || []), observed].map(item => [item.id, item])).values()].slice(-100);
        this.update(run, 'evidence_ready', 'Page source structure observed. Choose its ID and strategy in a plan.');
      });
    }
    if (command === 'actions') {
      await this.checkTab(run);
      if (active.has(run.status) || terminal.has(run.status) || run.draft) throw fail('INVALID_STATE', 'Task state changed.');
      if (!this.capabilities().capabilities.includes('safe_api_probe_v1')) throw fail('CAPABILITY_UNAVAILABLE', 'Reload the extension to enable safe API probes.');
      const release = this.tabLocks.acquire(run.tabId);
      let result;
      try { result = await this.request({ type: 'exploration_safe_actions_inspect', tabId: run.tabId }, 15000); }
      finally { release(); }
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
    if (command === 'generate' || command === 'repair') return this.generate(run, args.plan, command === 'repair' ? args : null);
    if (!run.draft) throw fail('INVALID_STATE', 'Generate a draft first.');
    if (command === 'verification-read' || command === 'verification-write') {
      const tool = textArg(args.tool, 'tool', 200);
      if (!run.draft.toolNames.includes(tool)) throw fail('INVALID_ARGUMENT', 'Select a tool generated or selected for repair by this task.');
      const cases = run.verification?.[tool] || [];
      if (command === 'verification-read') return { tool, cases: clone(cases), hash: hash(JSON.stringify(cases)) };
      if (!this.capabilities().capabilities.includes('strict_output_contract_v1')) throw fail('CAPABILITY_UNAVAILABLE', 'Reload the extension to enable authored output assertions.');
      if (args.expectedHash !== hash(JSON.stringify(cases))) throw fail('STALE_VERIFICATION', 'Cases changed; read their current hash before editing.');
      const normalized = normalizeVerificationCases(args.cases);
      run.verification = { ...run.verification, [tool]: normalized };
      run.validation = null; run.runtimeSummary = null; run.runtimeDigest = null; run.review = null;
      this.update(run, 'draft', 'Verification cases changed; validate again.');
      return { tool, caseCount: normalized.length, hash: hash(JSON.stringify(normalized)) };
    }
    if (command === 'draft-add') {
      if (run.repairScope) throw fail('REPAIR_SCOPE_CHANGED', 'Scoped repair cannot add shared or command files. Edit only the selected modules and their schema/description.');
      const file = textArg(args.file, 'file', 200);
      if (!(file === 'guidance.md' || /^extension\/(?:internal|commands)\/[a-zA-Z0-9][a-zA-Z0-9_/-]*\.js$/.test(file)) || file.includes('..') || path.basename(file) === 'index.js') throw fail('INVALID_ARGUMENT', 'Add guidance.md or a non-index JavaScript file under extension/internal or extension/commands.');
      if (run.draftFiles.some(name => name.toLowerCase() === file.toLowerCase())) throw fail('FILE_EXISTS', 'File already exists; use draft-write with its current hash.');
      if (run.draftFiles.length >= 512 || typeof args.content !== 'string' || args.content.length > 250000) throw fail('INVALID_ARGUMENT', 'Draft file count or content size exceeds the package limit.');
      const target = assertManagedFile(run.draft.adapterDir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, args.content, { flag: 'wx', mode: 0o600 });
      run.draftFiles = [...run.draftFiles, file].sort();
      run.validation = null; run.runtimeSummary = null; run.runtimeDigest = null; run.review = null;
      this.update(run, 'draft', 'Draft file added; validate again.');
      return { file, hash: hash(args.content) };
    }
    if (command === 'draft-read') {
      if (args.file === undefined) return { files: run.draftFiles, ...(run.repairScope ? { editableFiles: run.editableFiles } : {}) };
      const file = textArg(args.file, 'file', 200);
      if (!run.draftFiles.includes(file)) throw fail('INVALID_ARGUMENT', 'File is not in this draft.');
      const content = fs.readFileSync(assertManagedFile(run.draft.adapterDir, file));
      return { file: args.file, content: content.toString('utf8'), hash: hash(content) };
    }
    if (command === 'draft-write') {
      const file = textArg(args.file, 'file', 200);
      if (!run.draftFiles.includes(file)) throw fail('INVALID_ARGUMENT', 'Only existing draft files can be edited.');
      if (run.repairScope && !run.editableFiles.includes(file)) throw fail('REPAIR_SCOPE_CHANGED', 'This file belongs to an unselected command or shared package content.');
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
      return { ...run.review, tools: readPackageDirectory(run.draft.adapterDir).manifest.commands,
        ...(run.repairScope ? { repair: { ...run.repairScope, editableFiles: run.editableFiles } } : {}) };
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

  async start({ requestId, goal, tabId, signature, allowedOrigins }) {
    if (this.runs.size >= 200) throw fail('TASK_LIMIT', 'Exploration task limit reached; archive task data before creating more.');
    const caps = this.capabilities();
    if (!caps.capabilities.includes('passive_exploration_v1')) throw fail('CAPABILITY_UNAVAILABLE', 'Reload the extension to enable passive API exploration.');
    const tab = (await this.tabs()).find(tab => tab.id === tabId);
    if (!tab) throw fail('TAB_CHANGED', 'Select a tab from exploration.tabs.');
    this.assertTabAvailable(tabId);
    const now = new Date().toISOString();
    const run = { schemaVersion: 1, taskId: randomUUID(), requestId, signature, goal, tabId, allowedOrigins, origin: new URL(tab.url).origin,
      siteKey: new URL(tab.url).hostname, createdAt: now, updatedAt: now, status: 'created', candidates: [], events: [], sequence: 0 };
    this.runs.set(run.taskId, run);
    try { return this.collect(run, true); }
    catch (error) { this.runs.delete(run.taskId); throw error; }
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
      const found = extractExplorationEvidence(capture, run.origin, run.allowedOrigins || []);
      run.candidates = [...new Map([...run.candidates, ...found].map(item => [item.id, item])).values()].slice(-100);
      this.update(run, 'evidence_ready', found.length ? 'Structural evidence collected; calling agent may select APIs.' : 'No usable evidence from permitted origins; interact with the page and collect again.');
    });
  }

  generate(run, proposedPlan, repair = null) {
    if (run.draft) return this.summary(run); // Repeated generation never overwrites an authored draft.
    if (repair && (!proposedPlan || typeof proposedPlan !== 'object')) throw fail('INVALID_PLAN', 'Repair requires an explicit plan naming existing command IDs and current source indexes.');
    const candidates = run.candidates.filter(item => (item.method === 'GET' || (item.method === 'POST' && ['json', 'form'].includes(item.requestEvidence.bodyKind))) && !new URL(item.url).pathname.includes(':id')
      && item.risk.level === 'read' && item.status >= 200 && item.status < 300);
    if (!candidates.length && !proposedPlan?.tools?.some(tool => tool?.sourcePageId)) throw fail('NO_READ_EVIDENCE', 'Collect a successful read query or observe a page source before generating.');
    // Keep original evidence indexes stable for agent-authored plans.
    run.memory = { siteKey: run.siteKey, siteHost: new URL(run.origin).hostname, siteOrigin: run.origin, canonicalEntryUrl: run.origin + '/',
      listApiCandidates: run.candidates.map(item => clone(item)), actionApiCandidates: [], pageSources: clone(run.pageSources || []) };
    const facade = this.facade(run);
    prepareGenerationRun(facade, { paths: this.paths });
    run.siteKey = facade.snapshot.siteKey; run.memory = facade.snapshot.input.memory;
    const plan = proposedPlan || buildQuickGenerationPlan({ ...run.memory, listApiCandidates: run.memory.listApiCandidates.map(item => item.method === 'GET' && candidates.some(candidate => candidate.id === item.id) ? item : { ...item, url: '' }) });
    if (!Array.isArray(plan.tools) || !plan.tools.length || plan.tools.length > 50) throw fail('INVALID_PLAN', 'Provide 1–50 read tools per draft. Split larger plans into incremental tasks.');
    for (const tool of plan.tools) {
      if (tool?.sourcePageId) {
        const observed = (run.pageSources || []).find(item => item.id === tool.sourcePageId);
        if (!observed || tool.risk !== 'read' || tool.strategy !== observed.source.strategy || tool.sourceApiIndexes !== undefined || tool.sourceApiKind !== undefined) throw fail('INVALID_PLAN', 'Page tools must bind an observed page ID and matching strategy without API evidence.');
        textArg(tool.readReason, 'readReason');
        continue;
      }
      const candidate = run.candidates[tool.sourceApiIndexes?.[0]];
      if (tool.risk !== 'read' || tool.sourceApiKind !== 'list' || !candidate || !candidates.some(item => item.id === candidate.id)) throw fail('INVALID_PLAN', 'Each tool must reference a successful observed read query by index.');
      if (candidate.method !== 'GET' && (typeof tool.readReason !== 'string' || !tool.readReason.trim() || tool.readReason.length > 2000)) throw fail('INVALID_PLAN', 'POST queries require an authored readReason explaining their read semantics.');
    }
    if (repair) {
      if (plan.tools.some(tool => typeof tool.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tool.name) || (!tool.sourcePageId && tool.sourceApiIndexes?.length !== 1))) throw fail('INVALID_PLAN', 'Repair plans use exact existing kebab-case IDs and one fresh API or page source per tool.');
      const prepared = writeRepairDraft({ site: textArg(repair.site, 'site', 128), expectedDigest: textArg(repair.expectedDigest, 'expectedDigest', 64),
        plan, memory: run.memory, candidates: run.candidates, outputRoot: path.join(this.root, run.taskId, randomUUID()), paths: this.paths });
      const knowledge = this.knowledge.read(run.siteKey, { activeDigest: prepared.scope.digest });
      const repairKnowledge = { hash: knowledge.hash, stale: knowledge.stale, staleReasons: knowledge.staleReasons,
        staleCommands: knowledge.staleCommands, importedTools: [] };
      const verification = {};
      for (const tool of prepared.draft.toolNames) {
        const cases = knowledge.knowledge?.commands?.[tool]?.cases;
        if (cases?.length) { verification[tool] = normalizeVerificationCases(cases); repairKnowledge.importedTools.push(tool); }
      }
      run.plan = clone(plan); run.draft = prepared.draft; run.repairScope = prepared.scope; run.editableFiles = prepared.editableFiles;
      run.repairKnowledge = repairKnowledge; run.verification = verification;
      run.draftFiles = [...readPackageDirectory(run.draft.adapterDir).files.keys()];
      this.update(run, 'draft', 'Scoped repair created. Review historical cases and verify against the current page before installation.');
      return this.summary(run);
    }
    run.plan = allocateGenerationPlan(run.memory, plan);
    const outputRoot = path.join(this.root, run.taskId, randomUUID());
    const apiTools = run.plan.tools.filter(tool => !tool.sourcePageId);
    const pageTools = run.plan.tools.filter(tool => tool.sourcePageId).map(tool => buildPageTool(run.siteKey, tool, run.pageSources.find(item => item.id === tool.sourcePageId)));
    const draft = apiTools.length
      ? writeAdapterPackageFromSiteMemory(run.memory, { outputRoot, plan: { ...run.plan, tools: apiTools }, additionalTools: pageTools, adapterPaths: this.paths })
      : writePackageDraft({ memory: run.memory, adapterDir: path.join(outputRoot, run.siteKey), supportBundle: { toolFiles: pageTools }, paths: this.paths });
    run.draft = { ...draft, toolNames: run.plan.tools.map(tool => `${run.siteKey}.${tool.name.replace(/_/g, '-')}`) };
    run.draftFiles = [...readPackageDirectory(run.draft.adapterDir).files.keys()];
    this.update(run, 'draft', 'Draft created. Inspect and edit it, then validate. No model was called.');
    return this.summary(run);
  }

  facade(run) {
    return { id: run.taskId, snapshot: { siteKey: run.siteKey, repairScope: run.repairScope, input: { tabId: run.tabId, memory: run.memory },
      artifacts: { draft: run.draft, staticValidation: run.validation } }, setArtifact() {} };
  }

  assertTabAvailable(tabId, taskId) {
    if ([...this.controllers.keys()].some(id => id !== taskId && this.runs.get(id)?.tabId === tabId)) {
      throw fail('TAB_BUSY', 'Another task still owns an in-flight operation on this tab. Wait for it to settle.');
    }
  }

  assertReadDraft(run) {
    const pkg = readPackageDirectory(run.draft.adapterDir);
    const retained = verifyRetainedPackage(pkg, readGenerationEvidence(run.draft.adapterDir), { paths: this.paths, repairScope: run.repairScope });
    if (pkg.manifest.commands.some(command => !retained.has(command.id) && (command.safety !== 'read' || command.runtime !== 'extension'))) throw fail('READ_ONLY_REQUIRED', 'This standalone workflow only validates new read-only Extension commands.');
    return pkg;
  }

  validate(run) {
    const pageTools = (run.plan?.tools || []).filter(tool => tool.sourcePageId).map(tool => `${run.siteKey}.${tool.name.replace(/_/g, '-')}`);
    if (pageTools.length && !this.capabilities().capabilities.includes('page_sources_v1')) throw fail('CAPABILITY_UNAVAILABLE', 'Reload the extension before validating page sources.');
    if ((run.repairScope ? run.draft.toolNames : pageTools).some(tool => !run.verification?.[tool]?.length)) throw fail('VERIFICATION_REQUIRED', 'Every repaired or page-based command needs authored verification cases; read or write cases before validation.');
    if (Object.keys(run.verification || {}).length && !this.capabilities().capabilities.includes('strict_output_contract_v1')) throw fail('CAPABILITY_UNAVAILABLE', 'Reload the extension before validating authored assertions.');
    this.assertTabAvailable(run.tabId, run.taskId);
    run.review = null; run.runtimeDigest = null; run.runtimeSummary = null;
    return this.launch(run, 'validating', async signal => {
      await this.checkTab(run);
      if (signal.aborted) return;
      run.validation = validateAdapterDraft({ adapterDir: run.draft.adapterDir, expectedSiteKey: run.siteKey, expectedToolNames: run.draft.toolNames, paths: this.paths, repairScope: run.repairScope });
      if (!run.validation.passed) { this.update(run, 'draft', 'Static validation failed; inspect validation errors.'); return; }
      this.assertReadDraft(run);
      const runtime = await this.runtimeValidator({ run: this.facade(run), draft: run.draft, signal, plan: run.plan, memory: run.memory, validation: run.validation, verification: run.verification });
      if (signal.aborted) return;
      await this.checkTab(run);
      if (signal.aborted) return;
      // Persist only verifier summaries, never observed result bodies/test inputs.
      const counts = runtime.executionSummary;
      run.runtimeSummary = { passed: runtime.passed === true, executionSummary: counts ? { attempted: counts.attempted, passed: counts.passed, skipped: counts.skipped, failed: counts.failed } : null,
        errors: (runtime.errors || []).slice(0, 20).map(error => ({ code: String(error.code || 'VALIDATION_FAILED'),
          ...(error.toolName ? { tool: String(error.toolName).slice(0, 200) } : {}),
          ...(error.caseId ? { caseId: String(error.caseId).slice(0, 64) } : {}),
          ...(error.path ? { path: String(error.path).slice(0, 200) } : {}) })) };
      const count = run.draft.toolNames.reduce((total, name) => total + (run.verification?.[name]?.length || 1), 0);
      if (!runtime.passed || !counts || counts.attempted !== count || counts.passed !== count || counts.skipped !== 0 || counts.failed !== 0) {
        this.update(run, 'draft', 'Runtime validation incomplete; repair the draft or page state and validate again.'); return;
      }
      if (readPackageDirectory(run.draft.adapterDir).digest !== run.validation.packageDigest) throw fail('STALE_DRAFT', 'Draft changed during verification.');
      run.runtimeDigest = run.validation.packageDigest;
      run.verifiedAt = new Date().toISOString();
      this.update(run, 'review_ready', 'Read tools passed validation. Review before installation.');
    });
  }

  assertValidated(run) {
    const pkg = this.assertReadDraft(run);
    if (run.status !== 'review_ready' || !run.validation?.passed || run.runtimeDigest !== pkg.digest) throw fail('VALIDATION_REQUIRED', 'Validate the current draft before review or installation.');
  }
}
