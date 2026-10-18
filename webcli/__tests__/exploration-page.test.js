import { it, expect } from 'vitest';
import { normalizePageSource, pageObservation, pageSourceEvidence } from '../exploration-page.js';
import { buildRuntimeTestCases } from '../generation-harness/runtime-test-policy.js';
import { applyVerificationCases } from '../exploration-verification.js';

it('normalizes portable page locators and rejects credentials, scripts and prototype paths', () => {
  for (const path of [['document', 'cookie'], ['exampleState', '__proto__'], ['sessionStorage'], ['exampleState', 'apiKey']]) expect(() => normalizePageSource({ strategy: 'DOM_STATE', path })).toThrow();
  expect(() => normalizePageSource({ strategy: 'DOM_STATE', path: ['exampleState'], expression: 'alert(1)' })).toThrow();
  expect(() => normalizePageSource({ strategy: 'UI_SELECTOR', selector: '.row', fields: { id: { attribute: 'onclick' } } })).toThrow();
  expect(normalizePageSource({ strategy: 'DOM_STATE', jsonSelector: '#data' }).path).toEqual([]);
});
it('creates page evidence without fabricated API endpoints or captured values and requires matching live observation plus cases', () => {
  const observation = pageObservation({ source: normalizePageSource({ strategy: 'DOM_STATE', path: ['exampleState'] }),
    url: 'https://example.com/items?q=%3Cvalue%3E', shape: { type: 'array', length: 1, items: { type: 'string', value: 'private-example' } }, reason: 'Read current public item state' });
  expect(JSON.stringify(observation)).not.toContain('private-example');
  const generationSource = pageSourceEvidence(observation);
  expect(generationSource.endpoint).toBeUndefined(); expect(generationSource.method).toBeUndefined();
  const tool = { name: 'example.com.read-state', generationSource };
  const plan = { tools: [{ name: 'read_state', risk: 'read', strategy: 'DOM_STATE', sourcePageId: observation.id }] };
  const memory = { pageSources: [observation], listApiCandidates: [{ url: 'https://example.com/api/unrelated', method: 'GET', responsePreview: '[]' }] };
  const cases = buildRuntimeTestCases({ registeredTools: [tool], plan, memory });
  expect(cases[0].execute).toBe(false); expect(cases[0].contract.kind).toBe('page_observation');
  const verification = { [tool.name]: [{ id: 'read', args: {}, expect: { requiredPaths: ['data'] } }] };
  expect(applyVerificationCases(cases, verification)[0].execute).toBe(true);
  const missing = buildRuntimeTestCases({ registeredTools: [tool], plan, memory: { ...memory, pageSources: [] } });
  expect(applyVerificationCases(missing, verification)[0].execute).toBe(false);
});
