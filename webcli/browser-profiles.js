import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertManagedDirectory, assertManagedFile } from './adapter-package-files.js';

export const profileError = (code, message) => Object.assign(new Error(message), { code });
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const aliasPattern = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const reserved = new Set(['legacy', 'auto', 'none', '__proto__', 'constructor', 'prototype']);

export function profileHelp() {
  return { schemaVersion: 1, namespace: 'profile', selection: 'flag --profile > WEBCLI_PROFILE > saved default > only online connection; never fall back from an offline selection',
    commands: [
      { name: 'profile.list', params: [], description: 'Known browser contexts, aliases, online status and saved default.' },
      { name: 'profile.rename', params: ['contextId', 'name'], description: 'Assign a unique alias to a known context.' },
      { name: 'profile.use', params: ['name'], description: 'Persist an ID/alias as default; auto clears the default.' },
    ], legacy: 'Use --profile=legacy to read pre-profile sessions and exploration history. It never controls a browser. Rebind sessions and start new tasks explicitly.' };
}

/** Browser identities are independent of the Adapter/build profile and contain no account or path information. */
export class BrowserProfiles {
  constructor(workspaceDir) {
    this.workspaceDir = workspaceDir;
    this.root = path.join(workspaceDir, 'browser-profiles');
    assertManagedDirectory(this.root); fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.file = assertManagedFile(this.root, 'profiles.json');
    this.state = { schemaVersion: 1, defaultContextId: null, contexts: [] };
    this.connections = new Map();
    try {
      if (fs.existsSync(this.file)) this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.validate(this.state);
    } catch { throw profileError('PROFILE_STORE_INVALID', 'Browser profile configuration is invalid. Preserve it and repair the configuration before retrying.'); }
  }
  validate(state) {
    if (state?.schemaVersion !== 1 || !Array.isArray(state.contexts)) throw new Error('Invalid store');
    const ids = new Set(), aliases = new Set();
    for (const item of state.contexts) {
      if (!idPattern.test(item.contextId) || ids.has(item.contextId)) throw new Error('Invalid identity');
      ids.add(item.contextId);
      if (item.alias !== null) {
        if (!aliasPattern.test(item.alias) || idPattern.test(item.alias) || reserved.has(item.alias) || aliases.has(item.alias)) throw new Error('Invalid alias');
        aliases.add(item.alias);
      }
    }
    if (state.defaultContextId !== null && !ids.has(state.defaultContextId)) throw new Error('Invalid default');
  }
  save(state) {
    this.validate(state);
    const temp = assertManagedFile(this.root, `profiles.${randomUUID()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, this.file); this.state = state;
  }
  register(ws, hello) {
    const contextId = hello.contextId;
    if (contextId !== undefined && !idPattern.test(contextId)) throw profileError('PROFILE_ID_INVALID', 'Extension browser contextId must be a UUID v4.');
    if (ws._browserConnection) {
      if (ws._browserConnection.legacy !== (contextId === undefined) || (contextId !== undefined && ws._browserConnection.contextId !== contextId)) throw profileError('PROFILE_ID_CHANGED', 'A connection cannot change its browser identity.');
      return ws._browserConnection;
    }
    // Old extensions are ephemeral: one connection remains usable, but no
    // persistent binding can be mistaken for a different legacy browser.
    const id = contextId || `legacy-${randomUUID()}`;
    if (this.connections.has(id)) throw profileError('PROFILE_ID_CONFLICT', 'Another live extension has this contextId. Disconnect the duplicate or reset its webcliBrowserContextId storage key; no connection was replaced.');
    if (contextId && !this.state.contexts.some(item => item.contextId === id)) {
      this.save({ ...this.state, contexts: [...this.state.contexts, { contextId: id, alias: null }] });
    }
    const connection = { contextId: id, ws, connectionId: randomUUID(), legacy: !contextId,
      version: typeof hello.version === 'string' ? hello.version : null,
      capabilities: Array.isArray(hello.capabilities) ? [...new Set(hello.capabilities.filter(value => typeof value === 'string'))] : [] };
    this.connections.set(id, connection); ws._browserConnection = connection;
    return connection;
  }
  disconnect(ws) {
    const connection = ws._browserConnection;
    if (connection && this.connections.get(connection.contextId) === connection) this.connections.delete(connection.contextId);
    return connection;
  }
  known(name) {
    if (typeof name !== 'string' || !name) throw profileError('PROFILE_INVALID', 'Choose a contextId or alias from profile.list.');
    if (this.connections.get(name)?.legacy) throw profileError('EXTENSION_UPGRADE_REQUIRED', 'Reload the current extension to persist a browser identity, alias or default.');
    const record = this.state.contexts.find(item => item.contextId === name || item.alias === name);
    if (!record) throw profileError('PROFILE_NOT_FOUND', 'Unknown browser profile. Use profile.list.');
    return record;
  }
  select(name, { allowOffline = false } = {}) {
    if (name === 'legacy') return { contextId: 'legacy', connection: null, readOnly: true };
    const selected = name ?? this.state.defaultContextId;
    if (selected !== null && selected !== undefined) {
      const ephemeral = this.connections.get(selected);
      if (ephemeral?.legacy) return { contextId: selected, connection: ephemeral };
      const record = this.known(selected), knownConnection = this.connections.get(record.contextId);
      const connection = knownConnection?.ws.readyState === 1 ? knownConnection : null;
      if (!connection && !allowOffline) throw profileError('PROFILE_OFFLINE', 'The selected browser profile is offline. Reconnect it or explicitly choose another profile.');
      return { contextId: record.contextId, connection: connection || null };
    }
    const online = [...this.connections.values()].filter(item => item.ws.readyState === 1);
    if (online.length > 1) throw profileError('PROFILE_AMBIGUOUS', 'Multiple browsers are connected. Choose --profile using profile.list.');
    if (!online.length) throw profileError('EXTENSION_UNAVAILABLE', 'Connect the WeWorker extension or select an offline profile explicitly to read its history.');
    return { contextId: online[0].contextId, connection: online[0] };
  }
  assertConnection(route) {
    if (route?.readOnly) throw profileError('LEGACY_READ_ONLY', 'Pre-profile history is read-only. Explicitly bind a session or start a task in the intended browser profile.');
    if (!route?.connection) throw profileError('PROFILE_OFFLINE', 'The selected browser profile is offline.');
    if (route.connection.ws.readyState !== 1 || this.connections.get(route.contextId) !== route.connection) {
      throw profileError('PROFILE_DISCONNECTED', 'The selected browser connection ended. Inspect state before explicitly retrying; actions are never replayed.');
    }
    return route.connection;
  }
  serviceRoot(route, namespace) {
    return route.readOnly ? path.join(this.workspaceDir, namespace) : assertManagedFile(this.root, route.contextId + '/' + namespace);
  }
  execute(command, args = {}) {
    const params = { help: [], list: [], rename: ['contextId', 'name'], use: ['name'] };
    if (!Object.hasOwn(params, command)) throw profileError('UNKNOWN_COMMAND', 'Use webcli call profile.help.');
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !params[command].includes(key))) throw profileError('INVALID_ARGUMENT', 'Unknown profile command argument.');
    if (command === 'help') return profileHelp();
    if (command === 'rename') {
      const record = this.known(args.contextId);
      if (typeof args.name !== 'string' || !aliasPattern.test(args.name) || idPattern.test(args.name) || reserved.has(args.name)) throw profileError('PROFILE_ALIAS_INVALID', 'Use a unique alias starting with a letter, with up to 64 letters, digits, underscores or hyphens.');
      if (this.state.contexts.some(item => item.contextId !== record.contextId && item.alias === args.name)) throw profileError('PROFILE_ALIAS_CONFLICT', 'This alias already belongs to another browser.');
      this.save({ ...this.state, contexts: this.state.contexts.map(item => item === record ? { ...item, alias: args.name } : item) });
    }
    if (command === 'use') this.save({ ...this.state, defaultContextId: args.name === 'auto' ? null : this.known(args.name).contextId });
    return { defaultContextId: this.state.defaultContextId, profiles: [
      ...this.state.contexts.map(item => ({ ...item, online: this.connections.get(item.contextId)?.ws.readyState === 1, extensionVersion: this.connections.get(item.contextId)?.version || null })),
      ...[...this.connections.values()].filter(item => item.legacy).map(item => ({ contextId: item.contextId, online: true, ephemeral: true, upgradeRequired: true })),
      { contextId: 'legacy', online: false, readOnly: true, description: 'Pre-profile sessions and exploration history' },
    ] };
  }
}
