import { expect, it } from 'vitest';
import { normalizeWriteResult, resolveWriteResult, savedWriteResult, writeResultIdentityMatches } from '../exploration-write-result.js';

const origin = 'https://example.com';
const spec = { url: origin + '/items/:id', publicId: true, responsePath: 'item.id', identityPath: 'id', expect: { equals: { title: 'After' } } };

it('binds only an own public response field and preserves string identity, zeros and Unicode', () => {
  const normalized = normalizeWriteResult(spec, { item: { id: 'example' } }, origin);
  const binding = resolveWriteResult(normalized, { item: { id: '007示例' }, unrelated: 'not retained' }, origin);
  expect(binding).toEqual({ id: '007示例', url: origin + '/items/007%E7%A4%BA%E4%BE%8B' });
  expect(writeResultIdentityMatches({ id: '007示例' }, normalized, binding.id)).toBe(true);
  expect(writeResultIdentityMatches({ id: 7 }, normalized, '007')).toBe(false);
  expect(() => resolveWriteResult(normalized, { item: Object.create({ id: 'example' }) }, origin)).toThrow();
});

it.each([undefined, null, 7, false, {}, [], '', '.', '..', '../other', 'a/b', 'a\\b', '%2e', 'https://example.org', 'a?b', 'a#b', 'a\n', '[REDACTED]', 'x'.repeat(513), '\ud800'])('rejects unsafe or absent response identity %#', id => {
  expect(() => resolveWriteResult(spec, { item: { id } }, origin)).toThrow();
});

it.each([
  { publicId: false }, { responsePath: 'access_token' }, { responsePath: 'item.*.id' }, { responsePath: '__proto__.id' },
  { responsePath: 'item.constructor' }, { identityPath: 'session.id' }, { responsePath: 'item..id' },
  { url: origin + '/items/:id/:id' }, { url: 'https://example.org/items/:id' }, { url: origin + '/items/:id?q=x' },
  { url: origin + '/items/:id#x' }, { url: 'https://example:placeholder@example.com/items/:id' },
  { url: origin + '/delete/:id' }, { expect: { equals: { id: 'example' } } },
  { expect: { equals: { '$.id': 'example' } } }, { expect: { equals: { '.id': 'example' } } }, { unexpected: true },
])('rejects unreviewable result readback declarations %#', patch => {
  expect(() => normalizeWriteResult({ ...spec, ...patch }, { item: { id: 'example' } }, origin)).toThrow();
});

it('requires a captured binding for recovery and rejects another origin before requests', () => {
  const execution = { effect: { resultReadback: spec }, http: { origins: [origin] } };
  expect(() => savedWriteResult(execution)).toThrow(expect.objectContaining({ code: 'WRITE_RESULT_ID_UNAVAILABLE' }));
  execution.resultBinding = { id: '007' };
  expect(savedWriteResult(execution).url).toBe(origin + '/items/007');
  execution.http.origins = ['https://example.org'];
  expect(() => savedWriteResult(execution)).toThrow();
});
