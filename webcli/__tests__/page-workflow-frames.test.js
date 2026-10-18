import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeWorkflowFrames } from '../page-workflow-frames.js';

const declarations = [{ selector: '#chosen', origin: 'https://example.org', pathname: '/frame' }, { selector: '#nested', origin: 'https://example.com', pathname: '/leaf' }];
it('retains ordered nested owner declarations and exact frame origins without ephemeral identities', () => {
  expect(normalizeWorkflowFrames(declarations)).toEqual(declarations);
  for (const extra of [{ frameId: 7 }, { documentId: 'example-document' }, { index: 1 }]) expect(() => normalizeWorkflowFrames([{ ...declarations[0], ...extra }])).toThrow();
});
it('rejects incomplete, unbounded and ambiguous origin/path declarations', () => {
  for (const value of [[], null, Array(9).fill(declarations[0]), [{ ...declarations[0], origin: 'https://example.org/' }], [{ ...declarations[0], selector: '' }],
    [{ ...declarations[0], pathname: '/items/:id' }], [{ ...declarations[0], pathname: '/frame?q=1' }], [{ ...declarations[0], pathname: '//example.org/frame' }],
    [{ ...declarations[0], pathname: '/frame#section' }]]) expect(() => normalizeWorkflowFrames(value)).toThrow();
});
it('keeps host and extension normalization identical', () => {
  expect(readFileSync(new URL('../page-workflow-frames.js', import.meta.url), 'utf8')).toBe(readFileSync(new URL('../../extension/background/page-workflow-frames.js', import.meta.url), 'utf8'));
});
