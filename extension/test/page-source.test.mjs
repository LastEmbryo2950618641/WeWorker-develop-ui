import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readPageSource } from '../background/page-source.js';

const element = (text, children = {}, attrs = {}) => ({ tagName: 'A', textContent: text,
  getClientRects: () => [1], querySelectorAll: selector => children[selector] || [], getAttribute: key => attrs[key] ?? null });
function invoke(source, { state = {}, selectors = {}, metadataOnly = false, expectedPath = '/items' } = {}) {
  const context = vm.createContext({ window: state, location: { origin: 'https://example.com', pathname: '/items' },
    document: { querySelectorAll: selector => selectors[selector] || [] }, getComputedStyle: () => ({ visibility: 'visible' }),
    input: { source, expectedOrigin: 'https://example.com', expectedPath, metadataOnly } });
  return JSON.parse(JSON.stringify(vm.runInContext(`(${readPageSource.toString()})(input)`, context)));
}
const dom = { strategy: 'UI_SELECTOR', selector: '.row', fields: { title: { selector: '.title' }, link: { attribute: 'href' } } };
test('returns declared fields from every DOM row and structural observation excludes values', () => {
  const selectors = { '.row': [element('', { '.title': [element('Example private title')] }, { href: '/items/1' })] };
  assert.deepEqual(invoke(dom, { selectors }).data.items, [{ title: 'Example private title', link: '/items/1' }]);
  const metadata = invoke(dom, { selectors, metadataOnly: true });
  assert.equal(metadata.shape.properties.items.items.properties.title.type, 'string');
  assert.equal(JSON.stringify(metadata).includes('Example private title'), false);
});
test('rejects ambiguous and missing fields instead of returning a partial valid-looking list', () => {
  const selectors = { '.row': [element('', { '.title': [element('one'), element('two')] }, { href: '/' })] };
  assert.equal(invoke(dom, { selectors }).error.code, 'PAGE_FIELD_AMBIGUOUS');
  selectors['.row'] = [element('', {}, { href: '/' })];
  assert.equal(invoke(dom, { selectors }).error.code, 'PAGE_FIELD_MISSING');
});
test('reads rendered field text and rejects hidden required content', () => {
  const title = { ...element('Example title hidden script'), innerText: 'Example title' };
  const selectors = { '.row': [element('', { '.title': [title] }, { href: '/' })] };
  assert.equal(invoke(dom, { selectors }).data.items[0].title, 'Example title');
  title.getClientRects = () => [];
  assert.equal(invoke(dom, { selectors }).error.code, 'PAGE_FIELD_MISSING');
});
test('distinguishes observed empty-state marker from missing selectors and reports truncation', () => {
  assert.equal(invoke(dom).error.code, 'PAGE_SOURCE_MISSING');
  assert.equal(invoke({ ...dom, emptySelector: '#empty' }, { selectors: { '#empty': [element('No items')] } }).data.items.length, 0);
  const source = { strategy: 'UI_SELECTOR', selector: '.row', fields: { title: {} }, limit: 1 };
  const result = invoke(source, { selectors: { '.row': [element('one'), element('two')] } });
  assert.equal(result.data.items.length, 1); assert.equal(result.data.truncated, true); assert.equal(result.data.matchedCount, 2);
});
test('reads own state data without invoking getters or exposing nested credentials', () => {
  const state = { exampleState: { items: [{ id: 'example-item' }] } };
  assert.deepEqual(invoke({ strategy: 'DOM_STATE', path: ['exampleState', 'items'] }, { state }).data, state.exampleState.items);
  let called = false; Object.defineProperty(state, 'accessor', { get() { called = true; return []; } });
  assert.equal(invoke({ strategy: 'DOM_STATE', path: ['accessor'] }, { state }).error.code, 'PAGE_SOURCE_ACCESSOR'); assert.equal(called, false);
  state.exampleState.credentials = 'placeholder-secret';
  assert.equal(invoke({ strategy: 'DOM_STATE', path: ['exampleState'] }, { state }).error.code, 'PAGE_SOURCE_SENSITIVE');
});
test('reads JSON scripts as data and rejects ambiguous scripts and inherited paths', () => {
  const script = { tagName: 'SCRIPT', type: 'application/json', textContent: '{"items":[{"id":"example-id"}]}' };
  const source = { strategy: 'DOM_STATE', jsonSelector: '#data', path: ['items'] };
  assert.deepEqual(invoke(source, { selectors: { '#data': [script] } }).data, [{ id: 'example-id' }]);
  assert.equal(invoke(source, { selectors: { '#data': [script, script] } }).error.code, 'PAGE_SOURCE_MISSING');
  assert.equal(invoke({ strategy: 'DOM_STATE', path: ['inherited'] }, { state: Object.create({ inherited: [] }) }).error.code, 'PAGE_SOURCE_MISSING');
});
test('rejects changed routes and oversize data rather than silently truncating state', () => {
  const source = { strategy: 'DOM_STATE', path: ['exampleState'] };
  assert.equal(invoke(source, { expectedPath: '/other' }).error.code, 'PAGE_SOURCE_ROUTE_CHANGED');
  assert.equal(invoke(source, { state: { exampleState: Array(1001).fill('example') } }).error.code, 'PAGE_SOURCE_TOO_LARGE');
});
