'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  mergeBuildProfile,
  mergeExtensionManifest,
  parseBuildOptions,
} = require('../build-profile-overlay.cjs');

test('build overlay adds and removes adapters without changing the base profile', () => {
  const base = {
    adapters: ['public-a', 'public-b'],
    providers: [{ id: 'public-provider', name: 'Public' }],
    defaultProvider: 'public-provider',
  };
  const merged = mergeBuildProfile(base, {
    adapters: { add: ['internal-a', 'public-a'], remove: ['public-b'] },
  });

  assert.deepEqual(merged.adapters, ['public-a', 'internal-a']);
  assert.deepEqual(base.adapters, ['public-a', 'public-b']);
});

test('build overlay upserts providers and can select a different default', () => {
  const base = {
    adapters: [],
    providers: [{ id: 'a', name: 'Old' }, { id: 'b', name: 'B' }],
    defaultProvider: 'a',
  };
  const merged = mergeBuildProfile(base, {
    providers: { upsert: [{ id: 'a', name: 'New' }, { id: 'c', name: 'C' }], remove: ['b'] },
    defaultProvider: 'c',
  });

  assert.deepEqual(merged.providers, [{ id: 'a', name: 'New' }, { id: 'c', name: 'C' }]);
  assert.equal(merged.defaultProvider, 'c');
});

test('extension overlay produces a versioned manifest without changing the source', () => {
  const base = {
    version: '0.0.1',
    permissions: ['tabs'],
    host_permissions: ['<all_urls>'],
    content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }],
    web_accessible_resources: [{ matches: ['<all_urls>'], resources: ['asset.js'] }],
    action: { default_title: 'Public' },
  };
  const overlay = {
    permissions: { add: ['cookies'] },
    matches: { add: ['*://internal.example/*'] },
    actionDefaultTitle: 'Internal',
  };
  const merged = mergeExtensionManifest(base, overlay, '1.0.0');

  assert.equal(merged.version, '1.0.0');
  assert.deepEqual(merged.permissions, ['tabs', 'cookies']);
  assert.deepEqual(merged.host_permissions, ['<all_urls>', '*://internal.example/*']);
  assert.deepEqual(merged.content_scripts[0].matches, ['<all_urls>', '*://internal.example/*']);
  assert.deepEqual(merged.web_accessible_resources[0].matches, ['<all_urls>', '*://internal.example/*']);
  assert.equal(merged.action.default_title, 'Internal');
  assert.equal(base.version, '0.0.1');
  assert.deepEqual(base.permissions, ['tabs']);
});

test('build options use public by default and resolve an explicit overlay', () => {
  assert.deepEqual(parseBuildOptions([], {}, 'D:\\repo'), {
    profileName: 'public',
    overlayPath: null,
  });
  assert.deepEqual(parseBuildOptions(['--profile', 'internal', '--overlay', '../internal/profile.json'], {}, 'D:\\repo\\weworker'), {
    profileName: 'internal',
    overlayPath: path.resolve('D:\\repo\\weworker', '../internal/profile.json'),
  });
});

test('a complete internal profile needs no overlay and mismatches fail closed', () => {
  assert.deepEqual(parseBuildOptions([], {}, process.cwd(), 'internal'), {
    profileName: 'internal',
    overlayPath: null,
  });
  assert.throws(
    () => parseBuildOptions(['--profile', 'internal'], {}, process.cwd(), 'public'),
    /does not match build-profile\.json/,
  );
});
