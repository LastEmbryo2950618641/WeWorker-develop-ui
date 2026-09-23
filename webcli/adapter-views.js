import { describeAdapterCatalog } from './adapter-host.js';
import { assertAdapterIdentity } from './adapter-catalog.js';

function toolView(manifest, command) {
  const required = new Set(Array.isArray(command.schema?.required) ? command.schema.required : []);
  return {
    id: command.id, name: manifest.name + '.' + command.id, adapterId: manifest.name,
    aliases: [...(command.aliases || []).map((alias) => manifest.name + '.' + alias), ...(command.legacyNames || [])],
    description: command.description, runtime: command.runtime, safety: command.safety || 'read',
    parameters: command.schema,
    ...(command.execution?.runtime === 'background' ? { execution: command.execution, directCapable: true, executionMode: 'direct' } : {}),
    params: Object.entries(command.schema?.properties || {}).map(([name, schema]) => ({
      name, type: Array.isArray(schema?.type) ? schema.type.join('|') : schema?.type || 'any',
      description: schema?.description || '', required: required.has(name), enum: schema?.enum,
    })),
  };
}

export function managedAdapterViews(options = {}) {
  const catalog = describeAdapterCatalog(options);
  if (!catalog.available) throw new Error('Adapter catalog requires inspection before discovery.');
  return {
    managedNames: new Set(catalog.managedNames), diagnostics: catalog.diagnostics,
    adapters: catalog.adapters.map((manifest) => {
      const runtimes = [...new Set(manifest.commands.map((command) => command.runtime))];
      return {
        ...manifest, id: manifest.name, source: manifest._hostSnapshot.source,
        digest: manifest._hostSnapshot.digest, profile: manifest._hostSnapshot.profile,
        adapter_type: runtimes.length > 1 ? 'mixed' : runtimes[0] === 'wewright' ? 'toolkit' : 'extension',
        tools: manifest.commands.map((command) => toolView(manifest, command)),
      };
    }),
  };
}

export function managedAdapterView(name, options = {}) {
  assertAdapterIdentity(name);
  const snapshot = managedAdapterViews(options);
  const adapter = snapshot.adapters.find((entry) => entry.id === name);
  if (!adapter && snapshot.managedNames.has(name)) throw new Error(`Adapter "${name}" is disabled or unavailable.`);
  return adapter || null;
}

/** Derived descriptions never mutate a distributed package or contain host paths. */
export function managedAdapterSkill(adapter) {
  const lines = [
    '---', 'name: ' + JSON.stringify('webcli-' + adapter.id),
    'description: ' + JSON.stringify(adapter.description || adapter.id),
    'allowed-tools: Bash(webcli call *)', '---', '', '# ' + (adapter.display || adapter.id), '',
    adapter.description || '', '',
    'Package: ' + adapter.id + ' v' + adapter.version,
    'Source: ' + adapter.source + ' | Profile: ' + adapter.profile,
    'Content digest: ' + adapter.digest, '',
    'Use only the commands listed below. If the package changes, reload its current Skill before further calls.', '',
  ];
  if (adapter.match?.length) lines.push('Websites: ' + adapter.match.join(', '), 'Extension commands require an open matching website tab.', '');
  if (adapter.requires_auth) lines.push('Use the browser session authorized by the user; ask the user to log in when required.', '');
  for (const tool of adapter.tools) {
    lines.push('## ' + tool.name, '', tool.description, '', 'Runtime: ' + (tool.runtime === 'wewright' ? 'Toolkit' : 'Extension'), '');
    if (tool.aliases.length) lines.push('Compatible names: ' + tool.aliases.map((name) => '`' + name + '`').join(', '), '');
    if (tool.execution?.runtime === 'background') lines.push('Execution: background API. A matching website tab is needed only when a runtime helper explicitly requests page context.', '');
    if (tool.safety === 'write') lines.push('Obtain explicit user confirmation before calling this write command. Pass `__confirmed: true` only after confirmation.', '');
    for (const parameter of tool.params) {
      lines.push('- `' + parameter.name + '`: ' + parameter.type + (parameter.required ? ' (required)' : '')
        + (parameter.description ? ' — ' + parameter.description : '')
        + (parameter.enum ? ' Values: ' + JSON.stringify(parameter.enum) : ''));
    }
    lines.push('', 'Input JSON Schema:', '', '```json', JSON.stringify(tool.parameters, null, 2), '```');
    lines.push('', 'Call with `webcli call ' + tool.name + " --args '<JSON object>'`.", '');
  }
  return lines.join('\n') + '\n';
}
