import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveExtensionDir } from './paths.js';
import { runHttpTool } from './http-runner.js';
import { normalizeVerificationCases } from './exploration-verification.js';

let verifier;
async function strictVerifier() {
  // Load the same dependency-free versioned assertion implementation shipped
  // with the extension. A data module works in Node 18 even without package.json.
  if (!verifier) verifier = readFile(join(resolveExtensionDir(), 'background/strict-output-contract.js'), 'utf8')
    .then(source => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')))
    .then(module => module.verifyStrictOutput);
  return verifier;
}

export async function verifyHttpDraft({ pkg, adapterDir, commands, verification, requestExtension, signal, capabilities }) {
  const verify = await strictVerifier();
  const errors = [], counts = { attempted: 0, passed: 0, failed: 0, skipped: 0 };
  for (const command of commands) {
    const cases = normalizeVerificationCases(verification?.[command.name]);
    for (const test of cases) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      counts.attempted++;
      let failures;
      try {
        const { result } = await runHttpTool({ adapter: { root: adapterDir, digest: pkg.digest }, command }, test.args,
          { signal, resolveCookies: async payload => {
            // Standalone callers can fail early. Worker IPC also passes through
            // Bridge._request, which checks the actual pinned connection.
            if (payload.version === 2 && capabilities && !capabilities().includes('http_credentials_v2')) throw new Error('Scoped HTTP cookie capability unavailable.');
            return (await requestExtension({ type: 'http_credentials', payload }, 10_000)).cookies;
          } });
        failures = verify(result, test.expect);
        if (result?.ok === false || result?.error) failures.push({ code: 'HTTP_TOOL_ERROR' });
      } catch (error) { failures = [{ code: error.code || 'HTTP_VALIDATION_FAILED' }]; }
      if (failures.length) { counts.failed++; errors.push(...failures.map(error => ({ code: error.code, path: error.path, toolName: command.name, caseId: test.id }))); }
      else counts.passed++;
    }
  }
  return { validator: 'http_runtime_validator_v1', passed: counts.failed === 0, executionSummary: counts, errors, warnings: [] };
}
