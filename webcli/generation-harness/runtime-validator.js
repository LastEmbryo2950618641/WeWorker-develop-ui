import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildRuntimeTestCases } from './runtime-test-policy.js';
import { verifyGeneratedWriteTools } from './write-tool-verifier.js';
import { isPackageDraft, packageDraftBundle, readGenerationEvidence } from './package-inspection.js';
import { verifyRetainedPackage } from './existing-site.js';
import { applyVerificationCases } from '../exploration-verification.js';
import { verifyHttpDraft } from '../http-preview.js';
import { isBackgroundCommand } from '../exploration-background.js';

const MAX_PREVIEW_SCRIPT_CHARS = 1_000_000;
const SAFE_PREVIEW_SCRIPT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.js$/;

function createPreviewAdapterId(runId) {
  const token = String(runId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  if (!token) throw new Error('runId is required for preview validation');
  return `generation_preview_${token}`;
}

function resolvePreviewScript(adapterDir, relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!SAFE_PREVIEW_SCRIPT_RE.test(normalized) || normalized.includes('..')) {
    throw new Error(`preview script path is not allowed: ${relativePath}`);
  }
  const root = path.resolve(adapterDir);
  const filePath = path.resolve(root, normalized);
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`preview script escapes adapter directory: ${relativePath}`);
  }
  if (!fs.existsSync(filePath)) throw new Error(`preview script not found: ${normalized}`);
  return { path: normalized, filePath };
}

function buildInlinePreviewBundle(adapterDir) {
  if (isPackageDraft(adapterDir)) {
    const { pkg, manifest, scripts } = packageDraftBundle(adapterDir);
    if (scripts.reduce((total, script) => total + script.source.length, 0) > MAX_PREVIEW_SCRIPT_CHARS) throw new Error('Preview scripts exceed size limit.');
    return { manifest, scripts, packageDigest: pkg.digest };
  }
  const manifestPath = path.join(adapterDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`preview manifest not found in draft: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const supportFiles = Array.isArray(manifest.support_files) ? manifest.support_files : [];
  const scriptPaths = [...new Set([...supportFiles, 'index.js'])];
  let totalChars = 0;
  const scripts = scriptPaths.map((relativePath) => {
    const resolved = resolvePreviewScript(adapterDir, relativePath);
    const source = fs.readFileSync(resolved.filePath, 'utf8');
    totalChars += source.length;
    if (totalChars > MAX_PREVIEW_SCRIPT_CHARS) {
      throw new Error(`preview scripts exceed ${MAX_PREVIEW_SCRIPT_CHARS} characters`);
    }
    return { path: resolved.path, source };
  });
  return { manifest, scripts };
}

export function createPreviewRuntimeValidator({ requestExtension, restrictToExpectedTools = false, paths, capabilities } = {}) {
  if (typeof requestExtension !== 'function') throw new Error('runtime validator requires requestExtension');
  return async ({ run, draft, signal, plan, memory, validation, verification }) => {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (isPackageDraft(draft.adapterDir)) {
      const { pkg } = packageDraftBundle(draft.adapterDir);
      const httpCommands = pkg.commands.filter(command => command.runtime === 'http' && draft.toolNames.includes(command.name));
      if (httpCommands.length) {
        if (validation?.packageDigest && pkg.digest !== validation.packageDigest) throw new Error('Draft changed after static validation.');
        const httpResult = await verifyHttpDraft({ pkg, adapterDir: draft.adapterDir, commands: httpCommands, verification, requestExtension, signal, capabilities });
        const otherNames = draft.toolNames.filter(name => !httpCommands.some(command => command.name === name));
        if (!otherNames.length) return httpResult;
        const browserResult = await createPreviewRuntimeValidator({ requestExtension, restrictToExpectedTools: true, paths, capabilities })({
          run, draft: { ...draft, toolNames: otherNames }, signal, plan, memory, validation, verification });
        return { passed: httpResult.passed && browserResult.passed, errors: [...httpResult.errors, ...(browserResult.errors || [])],
          executionSummary: Object.fromEntries(['attempted', 'passed', 'failed', 'skipped'].map(key => [key, httpResult.executionSummary[key] + (browserResult.executionSummary?.[key] || 0)])) };
      }
    }
    const preview = {
      previewAdapterId: createPreviewAdapterId(run.id),
      transport: 'inline_bundle',
    };
    const previewBundle = buildInlinePreviewBundle(draft.adapterDir);
    const backgroundNames = (previewBundle.manifest.commands || []).filter(command => isBackgroundCommand(command) && draft.toolNames.includes(previewBundle.manifest.name + '.' + command.id)).map(command => previewBundle.manifest.name + '.' + command.id);
    if (backgroundNames.length) {
      const available = typeof capabilities === 'function' ? capabilities() : capabilities;
      if (!(Array.isArray(available) ? available : available?.capabilities || []).includes('background_preview_v1')) throw new Error('The selected extension needs background_preview_v1; page preview is not a substitute.');
      if (previewBundle.packageDigest && validation?.packageDigest && previewBundle.packageDigest !== validation.packageDigest) throw new Error('Draft changed after static validation.');
      const evidence = readGenerationEvidence(draft.adapterDir);
      verifyRetainedPackage(packageDraftBundle(draft.adapterDir).pkg, evidence, { paths, repairScope: run.snapshot.repairScope });
      const testCases = applyVerificationCases(buildRuntimeTestCases({
        registeredTools: previewBundle.manifest.commands.filter(command => backgroundNames.includes(previewBundle.manifest.name + '.' + command.id)).map(command => ({
          name: previewBundle.manifest.name + '.' + command.id, parameters: command.schema,
          generationSource: evidence.commands[command.id]?.generationSource })), plan, memory,
        repairedToolNames: backgroundNames,
      }), verification);
      const results = [];
      // One bounded background lifecycle per message, with cancellation checked
      // before the next case. Already dispatched reads are never replayed.
      for (let offset = 0; offset < testCases.length; offset += 1) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        const batch = testCases.slice(offset, offset + 1);
        const result = await requestExtension({ type: 'validate_generation_preview', executionMode: 'background',
          previewAdapterId: createPreviewAdapterId(run.id), previewBundle, siteKey: memory.siteHost || run.snapshot.siteKey,
          expectedToolNames: backgroundNames, testCases: batch }, 60000);
        if (result?.executionMode !== 'background' || result.pageContextUsed !== false
          || result.toolResults?.length !== batch.length || batch.some(item => !item.caseId
            || !result.toolResults.some(row => row.toolName === item.toolName && row.caseId === item.caseId && row.attempted))) {
          throw new Error('Background preview did not execute every authored case without a website page.');
        }
        results.push(result);
      }
      const otherNames = draft.toolNames.filter(name => !backgroundNames.includes(name));
      if (otherNames.length) results.push(await createPreviewRuntimeValidator({ requestExtension, restrictToExpectedTools: true, paths, capabilities })({
        run, draft: { ...draft, toolNames: otherNames }, signal, plan, memory, validation, verification }));
      return { passed: results.length > 0 && results.every(result => result.passed),
        errors: results.flatMap(result => result.errors || []),
        executionSummary: Object.fromEntries(['attempted', 'passed', 'failed', 'skipped'].map(key => [key, results.reduce((sum, result) => sum + (result.executionSummary?.[key] || 0), 0)])) };
    }
    const repairScope = run.snapshot.repairScope;
    if (previewBundle.packageDigest && validation?.packageDigest && previewBundle.packageDigest !== validation.packageDigest) throw new Error('Draft changed after static validation.');
    run.setArtifact('previewAdapter', { ...preview, packageDigest: previewBundle.packageDigest || null });
    try {
      const writeVerification = await verifyGeneratedWriteTools({
        adapterDir: draft.adapterDir,
        expectedSiteKey: run.snapshot.siteKey,
        paths, repairScope, signal,
      });
      run.setArtifact('writeVerification', writeVerification);
      if (!writeVerification.passed) {
        return {
          passed: false,
          validator: 'adapter_runtime_validator_v1',
          errors: writeVerification.errors,
          warnings: writeVerification.warnings || [],
          writeVerification,
        };
      }
      const registration = await requestExtension({
        type: 'validate_generation_preview',
        previewAdapterId: preview.previewAdapterId,
        previewBundle,
        siteKey: memory.siteHost || run.snapshot.siteKey,
        tabId: run.snapshot.input?.tabId,
        expectedToolNames: draft.toolNames || [],
      }, 45_000);
      if (!registration?.passed) {
        return { validator: 'adapter_runtime_validator_v1', ...registration };
      }
      const evidence = previewBundle.manifest.schema_version === 2 ? readGenerationEvidence(draft.adapterDir) : null;
      const retained = evidence ? verifyRetainedPackage(packageDraftBundle(draft.adapterDir).pkg, evidence, { paths, repairScope }) : new Set();
      const testCases = applyVerificationCases(buildRuntimeTestCases({
        registeredTools: (registration.tools || []).filter(tool =>
          !retained.has(tool.name.slice(previewBundle.manifest.name?.length + 1))
          && (!restrictToExpectedTools || (draft.toolNames || []).includes(tool.name))).map(tool => {
          const source = evidence?.commands?.[tool.name.slice(previewBundle.manifest.name?.length + 1)];
          return source ? { ...tool, generationSource: source.generationSource } : tool;
        }),
        plan,
        memory,
        repairedToolNames: repairScope ? repairScope.commandIds.map(id => `${repairScope.name}.${id}`) : [],
      }), verification);
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      // Extension previews bound each batch to five calls. Every planned case
      // must be sent, including plans larger than the historical two-tool limit.
      const executions = [];
      const cancellableQuery = previewBundle.manifest.commands?.some(command => command.pageRoute?.workflow || command.pageRoute?.navigation?.hashNavigation || command.pageRoute?.navigation?.resultOrigin);
      const batchSize = cancellableQuery ? 1 : 5;
      for (let offset = 0; offset < Math.max(testCases.length, 1); offset += batchSize) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        const operationId = cancellableQuery ? randomUUID() : undefined;
        const cancel = () => { requestExtension({ type: 'exploration_cancel_workflow', tabId: run.snapshot.input?.tabId, operationId }, 5000).catch(() => {}); };
        if (operationId) signal?.addEventListener('abort', cancel, { once: true });
        try { executions.push(await requestExtension({
          type: 'validate_generation_preview',
          previewAdapterId: preview.previewAdapterId,
          previewBundle,
          siteKey: memory.siteHost || run.snapshot.siteKey,
          tabId: run.snapshot.input?.tabId,
          expectedToolNames: draft.toolNames || [],
          testCases: testCases.slice(offset, offset + batchSize),
          ...(operationId ? { operationId } : {}),
        }, 60_000)); }
        finally { if (operationId) signal?.removeEventListener('abort', cancel); }
      }
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const execution = executions.length === 1 ? executions[0] : {
        passed: executions.every(result => result?.passed === true),
        errors: executions.flatMap(result => result?.errors || []),
        warnings: executions.flatMap(result => result?.warnings || []),
        toolResults: executions.flatMap(result => result?.toolResults || []),
        executionSummary: Object.fromEntries(['attempted', 'passed', 'failed', 'skipped'].map(key => [key,
          executions.reduce((total, result) => total + (result?.executionSummary?.[key] || 0), 0)])),
      };
      const warnings = [...(Array.isArray(execution?.warnings) ? execution.warnings : [])];
      for (const testCase of testCases) {
        if (testCase?.unverifiable) {
          warnings.push({
            code: 'TOOL_MARKED_UNVERIFIABLE',
            message: `工具 ${testCase.toolName} 已由修订标记为转人工验证，本轮跳过自动断言`,
            toolName: testCase.toolName,
          });
        }
      }
      return {
        validator: 'adapter_runtime_validator_v1',
        ...execution,
        warnings,
        registration,
        testCases,
        writeVerification,
      };
    } finally {
      run.setArtifact('previewAdapter', null);
    }
  };
}
