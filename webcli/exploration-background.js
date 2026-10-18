import { buildApiSourceEvidence } from './generation-harness/source-evidence.js';
import { draftCommandId } from './generation-harness/package-draft.js';

export const isBackgroundCommand = command => command?.runtime === 'extension'
  && command.execution?.type === 'api' && command.execution?.runtime === 'background';

// Reuse the installed Extension background runner. Authentication is authored
// from the observed site contract, never guessed from a captured response.
export function buildBackgroundTool(site, tool, candidate) {
  return {
    toolDefinition: { name: site + '.' + tool.name, runtime: 'extension', access: 'read',
      execution: { type: 'api', runtime: 'background' },
      description: tool.purpose || 'Read the observed API without a business page.',
      parameters: { type: 'object', properties: {}, additionalProperties: false, 'x-webcli-agent-authored': false },
      generationSource: candidate.sourceEvidence || buildApiSourceEvidence(candidate, { sourceKind: 'passive_list' }) },
    v2Content: `(function () {
  window.__webcliRegisterCommand(${JSON.stringify(draftCommandId(tool.name))}, async function (args = {}) {
    // Observed read: ${candidate.method} ${new URL(candidate.url).origin}${new URL(candidate.url).pathname}
    // Author the API mapping and authentication using __webmcpWecliRuntime.
    // cookies_get + backend_fetch can reuse login state without a website tab.
    // Never embed captured credentials, use page functions, or claim login from DOM.
    throw new Error('AGENT_AUTHORED_BACKGROUND_REQUIRED');
  });
})();\n`,
  };
}
