import { validateGenerationPreviewOutputV2 } from './generation-output-validator.js';

const background = command => command?.runtime === 'extension' && command.execution?.type === 'api'
  && command.execution?.runtime === 'background' && !command.pageRoute && !command.pageWorkflow && !command.pageStrategy;

// Only fixed, public categories cross the preview boundary. Adapter exceptions
// can contain credentials in their message, details, or even a custom code.
const publicFailureCodes = new Set(['LOGIN_REQUIRED', 'PAGE_CONTEXT_REQUIRED', 'INVALID_ARGS',
  'HTTP_ERROR', 'API_ERROR', 'INVALID_RESPONSE', 'BACKEND_HELPER_ERROR', 'MISSING_PERMISSION',
  'RUNTIME_UNAVAILABLE', 'ADAPTER_COMMAND_UNAVAILABLE']);

/** Execute authored reads in the same offscreen runner as installed commands.
 * No page lookup, injection, navigation or capture-bound arguments are allowed. */
export async function validateBackgroundPreview({ bundle, expectedToolNames, testCases = [], execute }) {
  const manifest = bundle?.manifest;
  if (manifest?.schema_version !== 2 || !Array.isArray(expectedToolNames) || !expectedToolNames.length) throw new Error('Background preview requires explicit v2 commands.');
  const commands = expectedToolNames.map(name => manifest.commands.find(command => `${manifest.name}.${command.id}` === name));
  if (commands.some(command => !background(command) || command.safety !== 'read')) throw new Error('Background preview requires read-only background commands.');
  const toolResults = [];
  for (const item of testCases.slice(0, 5)) {
    const command = commands.find(command => `${manifest.name}.${command.id}` === item.toolName);
    const identity = { toolName: item.toolName, ...(item.caseId ? { caseId: item.caseId } : {}) };
    if (!command || !item.execute || !item.caseId || item.captureBound || item.risk?.level !== 'read' || !(item.risk.confidence >= .75) || item.validationErrors?.length) {
      toolResults.push({ ...identity, attempted: false, passed: false, errors: [{ code: 'BACKGROUND_CASE_REQUIRED', message: 'Use explicit authored read arguments; page capture cannot prove background execution.' }] });
      continue;
    }
    try {
      const output = await execute(manifest, command, item.arguments || {}, bundle);
      if (output?.__webcli_page_query || output?.__webcli_navigation || output?.__cdp_action || output?.__after) throw new Error('Page continuation is not background execution.');
      toolResults.push({ ...identity, attempted: true, ...validateGenerationPreviewOutputV2(output, item.contract || {}) });
    } catch (error) {
      const code = publicFailureCodes.has(error?.code) ? error.code : 'BACKGROUND_PREVIEW_FAILED';
      toolResults.push({ ...identity, attempted: true, passed: false, errors: [{ code, message: 'Background read failed; inspect the authored authentication/request contract without exporting credentials.' }] });
    }
  }
  const errors = toolResults.flatMap(item => (item.errors || []).map(error => ({ ...error, toolName: item.toolName, ...(item.caseId ? { caseId: item.caseId } : {}) })));
  return { passed: toolResults.length > 0 && !errors.length, phase: 'execution', executionMode: 'background', pageContextUsed: false,
    tools: commands.map(command => ({ name: `${manifest.name}.${command.id}`, parameters: command.schema, description: command.description })),
    toolResults, errors, executionSummary: { attempted: toolResults.filter(item => item.attempted).length,
      passed: toolResults.filter(item => item.attempted && item.passed).length, failed: toolResults.filter(item => !item.passed).length, skipped: 0 } };
}

export function backgroundPreviewRequest(action, payload) {
  if (action === 'cookies_get') return { ...payload, browserDebugger: false };
  if (action === 'storage_get') return { ...payload, cacheOnly: true };
  // The Bridge checks read semantics before dispatch, rejects redirects and
  // bypasses replay fallbacks. Never let authentication failure open a page.
  if (action === 'backend_fetch') return { ...payload, backgroundPreviewRead: true, browserFallback: false, redactBodyInTrace: true };
  throw new Error('Background preview cannot use page helpers or write operations.');
}
