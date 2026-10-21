'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PATH = path.resolve(__dirname, '../renderer/src/config/deployment.json');

function normalizedUrl(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty URL`);
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${field} must be an http/https URL without credentials, query or hash`);
  }
  return value;
}

function validateDeploymentConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('deployment config must be an object');
  normalizedUrl(config.officialUrl, 'officialUrl');
  normalizedUrl(config.downloadUrl, 'downloadUrl');
  if (!Array.isArray(config.updateSources) || config.updateSources.length === 0) {
    throw new Error('updateSources must be a non-empty array');
  }
  const ids = new Set();
  for (const [index, source] of config.updateSources.entries()) {
    if (!source || typeof source !== 'object') throw new Error(`updateSources[${index}] must be an object`);
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(source.id || '') || ids.has(source.id)) {
      throw new Error(`updateSources[${index}].id must be unique and URL-safe`);
    }
    ids.add(source.id);
    if (typeof source.label !== 'string' || !source.label.trim()) throw new Error(`updateSources[${index}].label is required`);
    normalizedUrl(source.url, `updateSources[${index}].url`);
  }
  return config;
}

function loadDeploymentConfig(file = DEFAULT_PATH) {
  let config;
  try { config = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`failed to read deployment config: ${error.message}`); }
  return validateDeploymentConfig(config);
}

module.exports = { DEFAULT_PATH, loadDeploymentConfig, validateDeploymentConfig };
