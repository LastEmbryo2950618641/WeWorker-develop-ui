'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadDeploymentConfig, validateDeploymentConfig } = require('../deployment-config.cjs');

const root = path.resolve(__dirname, '../..');

test('the shared deployment config supplies desktop, renderer and builder URLs', () => {
  const deployment = loadDeploymentConfig();
  assert.ok(deployment.updateSources.some(source => source.url === deployment.downloadUrl));
  const updateManager = fs.readFileSync(path.join(root, 'electron/update-manager.js'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'renderer/src/components/settings/SettingsModal.jsx'), 'utf8');
  const builder = fs.readFileSync(path.join(root, 'scripts/build-electron-current-arch.cjs'), 'utf8');
  assert.match(updateManager, /loadDeploymentConfig/);
  assert.match(settings, /deployment\.updateSources/);
  assert.match(builder, /WEWORKER_PUBLISH_URL: deployment\.downloadUrl/);
  for (const value of [deployment.officialUrl, deployment.downloadUrl, ...deployment.updateSources.map(source => source.url)]) {
    assert.equal(updateManager.includes(value), false);
    assert.equal(settings.includes(value), false);
  }
});

test('deployment validation rejects credentials and duplicate update sources', () => {
  const valid = {
    officialUrl: 'https://example.com',
    downloadUrl: 'https://example.com/downloads/',
    updateSources: [{ id: 'official', label: 'Official', url: 'https://example.com/downloads/' }],
  };
  assert.equal(validateDeploymentConfig(valid), valid);
  assert.throws(() => validateDeploymentConfig({ ...valid, officialUrl: 'https://user:secret@example.com' }), /without credentials/);
  assert.throws(() => validateDeploymentConfig({ ...valid, updateSources: [...valid.updateSources, valid.updateSources[0]] }), /unique/);
});
