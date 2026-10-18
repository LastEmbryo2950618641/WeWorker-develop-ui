import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyStrictOutput } from '../background/strict-output-contract.js';
import { validateGenerationPreviewOutputV2 } from '../background/generation-output-validator.js';
const good = { ok: true, data: { items: [{ id: 'example-1', title: 'Example item', count: 2 }], page: 1 } };
const fixture = { version: 1, requiredPaths: ['data.items.*.id'], types: { 'data.items.*.count': 'integer' },
  notEmpty: ['data.items.*.title'], patterns: { 'data.items.*.id': '^example-[0-9]+$' }, equals: { 'data.page': 1 }, rowCount: { path: 'data.items', min: 1, max: 2 } };
test('checks final output with exact paths, every row and no response-wrapper fallback', () => {
  assert.deepEqual(verifyStrictOutput(good, fixture), []);
  assert.ok(verifyStrictOutput({ items: good.data.items, page: 1 }, fixture).length > 0);
  assert.ok(verifyStrictOutput({ data: { items: [good.data.items[0], { title: '' }], page: 1 } }, fixture).some(e => e.code === 'OUTPUT_REQUIRED_PATH_MISSING'));
  assert.ok(verifyStrictOutput({ data: { items: [{ ...good.data.items[0], count: null }], page: 1 } }, fixture).some(e => e.code === 'OUTPUT_FIELD_TYPE_MISMATCH'));
});
test('enforces counts, scalar values and patterns without including returned values in diagnostics', () => {
  const result = verifyStrictOutput({ data: { items: [{ id: 'placeholder-private', title: '', count: 1.5 }], page: 2 } }, fixture);
  assert.ok(result.some(e => e.code === 'OUTPUT_VALUE_MISMATCH'));
  assert.ok(result.some(e => e.code === 'OUTPUT_PATTERN_MISMATCH'));
  assert.doesNotMatch(JSON.stringify(result), /placeholder-private/);
  assert.ok(verifyStrictOutput({ data: { items: [] } }, fixture).some(e => e.code === 'OUTPUT_ROW_COUNT_MISMATCH'));
  assert.ok(verifyStrictOutput({ data: {} }, fixture).some(e => e.code === 'OUTPUT_ROW_COUNT_MISMATCH'));
});
test('supports nullable types and explicit empty-list expectations', () => {
  assert.deepEqual(verifyStrictOutput({ values: [{ x: null }, { x: 2 }] }, { version: 1, types: { 'values.*.x': 'integer|null' } }), []);
  assert.deepEqual(verifyStrictOutput([], { version: 1, rowCount: { path: '$', min: 0, max: 0 }, types: { '*.id': 'string' } }), []);
});
test('preview validator composes authored assertions with existing runtime failure checks', () => {
  assert.equal(validateGenerationPreviewOutputV2(good, { authoredFixture: fixture }).passed, true);
  assert.equal(validateGenerationPreviewOutputV2(good, { authoredFixture: { ...fixture, equals: { 'data.page': 2 } } }).passed, false);
});
