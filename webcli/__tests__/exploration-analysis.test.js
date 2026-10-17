import { expect, it } from 'vitest';
import { analyzeApiCandidate, analyzeExploration, normalizeStrategyNote } from '../exploration-analysis.js';
const candidate = { id: 'example', url: 'https://example.com/api/search?q=%3Cvalue%3E', method: 'GET', status: 200, risk: { level: 'read' },
  responseEvidence: { bodyKind: 'json', bodyShape: { type: 'object', properties: { data: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string', example: 'example-private-value' } } } } } } } };
it('describes data shapes without values or inferred official API contracts', () => {
  const result = analyzeApiCandidate(candidate, 3);
  expect(result).toMatchObject({ sourceApiIndex: 3, eligible: true, verdict: 'likely_data', contract: 'unverified', strategy: 'PAGE_FETCH' });
  expect(result.samplePaths).toContainEqual({ path: '$.data.*.title', type: 'string' });
  expect(JSON.stringify(result)).not.toContain('example-private-value');
});
it.each([
  [{ status: 403 }, 'blocked'], [{ status: 503 }, 'unavailable'],
  [{ url: 'https://example.com/telemetry/search' }, 'noise'], [{ risk: { level: 'write' } }, 'excluded'],
  [{ responseEvidence: { bodyKind: 'opaque' } }, 'not_json'],
])('excludes unsuitable evidence without guessing a fallback: %j', (extra, verdict) => {
  expect(analyzeApiCandidate({ ...candidate, ...extra })).toMatchObject({ eligible: false, verdict, strategy: null });
});
it('unknown JSON fields remain uncertain and never prove task semantics', () => {
  const result = analyzeApiCandidate({ ...candidate, responseEvidence: { bodyKind: 'json', bodyShape: { type: 'object', properties: { code: { type: 'integer' } } } } });
  expect(result.verdict).toBe('maybe_data'); expect(result.reasons).toContain('target_data_not_established');
});
it('auth failure recommends restoring access, while document changes point to query; no action executes', () => {
  const base = { taskId: 'example-task', candidates: [candidate], draft: { toolNames: ['example.com.search'] } };
  const auth = analyzeExploration({ ...base, runtimeSummary: { errors: [{ code: 'LOGIN_REQUIRED' }] } });
  expect(auth.nextActions[0]).toMatchObject({ action: 'restore_session', automaticFallback: false });
  expect(auth.nextActions.some(item => item.action === 'exploration.replan')).toBe(false);
  const navigation = analyzeExploration({ ...base, error: { code: 'INTERCEPT_DOCUMENT_CHANGED' } });
  expect(navigation.nextActions[0].action).toBe('exploration.query');
  expect(navigation.strategies.find(item => item.strategy === 'PUBLIC_API').available).toBe(false);
});
it('strategy rationale requires alternatives for internal endpoints and rejects unsupported fields', () => {
  expect(() => normalizeStrategyNote({ strategyNote: { reason: 'Public item query' } }, 'PAGE_FETCH')).toThrow(/Explain why/);
  const note = { reason: 'Read public current cards', limitations: 'Only rendered rows' };
  expect(normalizeStrategyNote({ strategyNote: note }, 'UI_SELECTOR')).toEqual(note);
  expect(() => normalizeStrategyNote({ strategyNote: { ...note, capturedResponse: 'example' } }, 'UI_SELECTOR')).toThrow();
});

it('does not recommend unavailable mutations for active, terminal or scoped repair tasks', () => {
  const run = { taskId: 'example-task', candidates: [candidate], draft: {}, error: { code: 'RESPONSE_NOT_JSON' } };
  expect(analyzeExploration({ ...run, status: 'validating' }).nextActions.map(item => item.action)).toEqual(['exploration.get']);
  expect(analyzeExploration({ ...run, status: 'installed' }).nextActions.map(item => item.action)).toEqual(['exploration.trace']);
  expect(analyzeExploration({ ...run, status: 'draft', repairScope: {} }).nextActions.some(item => item.action === 'exploration.replan')).toBe(false);
});
