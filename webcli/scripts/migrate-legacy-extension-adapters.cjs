/**
 * One-shot deterministic migration helper for public legacy Extension Adapters.
 * It wraps the preserved browser implementation instead of rewriting site logic.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)+)?$/;
const WRITE_COMMAND_RE = /(?:^|_)(?:like|favorite|buy|pay|compose|send|download|auto_download|cancel_download)(?:_|$)/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function kebab(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[_\s.]+/g, '-').toLowerCase();
}

function localToolName(adapterName, toolName) {
  const name = String(toolName || '');
  return name.startsWith(adapterName + '.') ? name.slice(adapterName.length + 1) : name;
}

function normalizeVersion(value) {
  return typeof value === 'string' && SEMVER_RE.test(value) ? value : '1.0.0';
}

function internalGlobalName(adapterName) {
  return '__' + adapterName.replace(/[^A-Za-z0-9]/g, '_').replace(/^([0-9])/, '_$1') + '_internal';
}

function createCaptureWindow() {
  const sandbox = {
    captured: [],
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    MutationObserver: class { observe() {} disconnect() {} },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    location: { href: 'https://example.com/', origin: 'https://example.com' },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.__webmcpRegister = (adapter) => sandbox.captured.push(adapter || {});
  return sandbox;
}

function runLegacySources({ root, manifest }) {
  const sandbox = createCaptureWindow();
  const files = [];
  for (const relative of manifest.support_files || []) {
    if (typeof relative !== 'string' || relative.includes('..') || path.isAbsolute(relative)) {
      throw new Error(`Unsafe support file declaration: ${relative}`);
    }
    files.push({ relative, source: fs.readFileSync(path.join(root, relative), 'utf8') });
  }
  if (fs.existsSync(path.join(root, 'index.js'))) {
    files.push({ relative: 'index.js', source: fs.readFileSync(path.join(root, 'index.js'), 'utf8') });
  }
  for (const file of files) {
    vm.runInNewContext(file.source, sandbox, { filename: file.relative });
  }
  const registeredTools = sandbox.captured.flatMap((adapter) => Array.isArray(adapter?.tools) ? adapter.tools : []);
  const supportTools = Object.values(sandbox.__webmcpGeneratedSupport || {})
    .flatMap((site) => Array.isArray(site?.tools) ? site.tools : []);
  const toolsByName = new Map();
  for (const tool of [...registeredTools, ...supportTools]) {
    for (const name of [tool?.publicName, tool?.name, tool?.handlerName]) {
      if (typeof name === 'string' && name && !toolsByName.has(name)) toolsByName.set(name, tool);
    }
  }
  const tools = [...toolsByName.values()];
  const matches = sandbox.captured.flatMap((adapter) => Array.isArray(adapter?.match) ? adapter.match : []);
  return { tools, matches, files };
}

function normalizeSchema(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { type: 'object', properties: {}, required: [] };
  }
  return JSON.parse(JSON.stringify(value));
}

function routeMetadata(tool) {
  const metadata = {};
  for (const key of ['routeDomain', 'tabDomain', 'excludeTabDomain']) {
    if (typeof tool?.[key] === 'string' && tool[key].trim()) metadata[key] = tool[key].trim();
  }
  return metadata;
}

function buildCommands(adapterName, tools) {
  const commands = [];
  const commandsById = new Map();
  for (const tool of tools) {
    const originalLocal = localToolName(adapterName, tool.publicName || tool.name || tool.handlerName);
    if (!originalLocal) throw new Error(`Legacy tool has no callable name for ${adapterName}`);
    const id = kebab(originalLocal);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new Error(`Cannot normalize legacy command ${adapterName}.${originalLocal}`);
    const aliases = [...new Set([originalLocal, ...(Array.isArray(tool.aliases) ? tool.aliases : [])]
      .map((name) => localToolName(adapterName, name))
      .filter((name) => name && name !== id))]
      .filter((name) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(name))
      .slice(0, 64);
    const duplicate = commandsById.get(id);
    if (duplicate) {
      duplicate.aliases = [...new Set([...(duplicate.aliases || []), ...aliases])].filter((name) => name !== id);
      continue;
    }
    const command = {
      id,
      runtime: 'extension',
      module: `extension/commands/${id}.js`,
      description: String(tool.description || `${adapterName} legacy command ${id}`).trim(),
      safety: WRITE_COMMAND_RE.test(originalLocal) ? 'write' : 'read',
      schema: normalizeSchema(tool.parameters),
      ...(aliases.length ? { aliases } : {}),
      ...routeMetadata(tool),
    };
    commandsById.set(id, command);
    commands.push(command);
  }
  if (!commands.length) throw new Error(`Legacy adapter ${adapterName} registered no tools`);
  return commands;
}

function buildManifest({ manifest, tools, matches }) {
  const name = manifest.id;
  const commandByName = new Map();
  for (const tool of tools) {
    const local = localToolName(name, tool.publicName || tool.name || tool.handlerName);
    commandByName.set(`${name}.${kebab(local)}`, tool);
  }
  const authTool = manifest.auth_check_tool && commandByName.has(manifest.auth_check_tool)
    ? manifest.auth_check_tool
    : (manifest.auth_check_tool ? `${name}.${kebab(localToolName(name, manifest.auth_check_tool))}` : undefined);
  const output = {
    schema_version: 2,
    name,
    version: normalizeVersion(manifest.version),
    description: String(manifest.description || `${name} legacy Adapter`).trim(),
    match: [...new Set([...(Array.isArray(manifest.match) ? manifest.match : []), ...matches])].filter(Boolean),
    requires_auth: manifest.requires_auth === true,
    commands: buildCommands(name, tools),
  };
  for (const key of ['homepage_url', 'icon', 'scenarios', 'test_prompts', 'quick_prompts', 'i18n', 'verified_on', 'generated_from', 'hidden']) {
    if (manifest[key] !== undefined) output[key] = manifest[key];
  }
  if (authTool) output.auth_check_tool = authTool;
  return output;
}

function buildLegacyWrapper(adapterName, files) {
  const embedded = files.map(({ relative, source }) => `/* embedded legacy source: ${relative} */\n${source}`).join('\n\n');
  return `/* v2 compatibility implementation for ${adapterName}; preserves the tracked legacy executable logic. */\n(function () {\n  var captured = [];\n  var previousRegister = window.__webmcpRegister;\n  window.__webmcpRegister = function (adapter) { captured.push(adapter || {}); };\n  window.__webmcpGeneratedSupport = window.__webmcpGeneratedSupport || {};\n  window.__webmcpGeneratedLegacyHandlers = window.__webmcpGeneratedLegacyHandlers || {};\n  try {\n${embedded}\n  } finally {\n    window.__webmcpRegister = previousRegister;\n  }\n  var tools = [];\n  for (var i = 0; i < captured.length; i++) {\n    var list = Array.isArray(captured[i].tools) ? captured[i].tools : [];\n    for (var j = 0; j < list.length; j++) if (list[j] && typeof list[j].handler === 'function') tools.push(list[j]);\n  }\n  var support = window.__webmcpGeneratedSupport[${JSON.stringify(adapterName)}];\n  if (support && Array.isArray(support.tools)) {\n    for (var k = 0; k < support.tools.length; k++) if (support.tools[k] && typeof support.tools[k].handler === 'function') tools.push(support.tools[k]);\n  }\n  var byName = Object.create(null);\n  for (var n = 0; n < tools.length; n++) {\n    var tool = tools[n];\n    var names = [tool.publicName, tool.name, tool.handlerName];\n    for (var z = 0; z < names.length; z++) if (typeof names[z] === 'string' && names[z] && !byName[names[z]]) byName[names[z]] = tool;\n  }\n  window[${JSON.stringify(internalGlobalName(adapterName))}] = {\n    invoke: async function (publicName, params) {\n      var tool = byName[publicName];\n      if (!tool || typeof tool.handler !== 'function') throw new Error('Legacy handler unavailable for ' + ${JSON.stringify(adapterName)} + '.' + publicName);\n      return tool.handler(params || {});\n    },\n    names: Object.keys(byName)\n  };\n})();\n`;
}

function buildCommandModule(adapterName, command) {
  const legacyName = command.aliases?.[0] ? `${adapterName}.${command.aliases[0]}` : `${adapterName}.${command.id}`;
  return `/* v2 command ${adapterName}.${command.id}; delegates to the preserved executable implementation. */\n(function () {\n  __webcliRegisterCommand(${JSON.stringify(command.id)}, async function (params) {\n    return window[${JSON.stringify(internalGlobalName(adapterName))}].invoke(${JSON.stringify(legacyName)}, params || {});\n  });\n})();\n`;
}

function migrateLegacyAdapter({ sourceDir, outputDir, overwrite = false }) {
  const root = path.resolve(sourceDir);
  const manifest = readJson(path.join(root, 'manifest.json'));
  const name = manifest.id;
  if (!name || manifest.schema_version === 2) throw new Error(`Source is not a legacy Adapter: ${root}`);
  const destination = path.resolve(outputDir, name);
  if (fs.existsSync(destination) && !overwrite) throw new Error(`Output already exists: ${destination}`);
  const legacy = runLegacySources({ root, manifest });
  const v2Manifest = buildManifest({ manifest, tools: legacy.tools, matches: legacy.matches });
  fs.mkdirSync(path.join(destination, 'extension/commands'), { recursive: true });
  fs.mkdirSync(path.join(destination, 'extension/internal'), { recursive: true });
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(v2Manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(destination, 'extension/internal/legacy.js'), buildLegacyWrapper(name, legacy.files));
  for (const command of v2Manifest.commands) {
    fs.writeFileSync(path.join(destination, command.module), buildCommandModule(name, command));
  }
  return { name, destination, manifest: v2Manifest };
}

function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) {
    console.error('Usage: node scripts/migrate-legacy-extension-adapters.cjs <adapter-id>...');
    process.exitCode = 2;
    return;
  }
  for (const id of ids) {
    const result = migrateLegacyAdapter({
      sourceDir: path.resolve(__dirname, '../../extension/adapters', id),
      outputDir: path.resolve(__dirname, '../../adapters'),
      overwrite: process.env.WORKER_ADAPTER_MIGRATION_OVERWRITE === '1',
    });
    console.log(`Migrated ${result.name} -> ${path.relative(process.cwd(), result.destination)}`);
  }
}

module.exports = { buildCommands, buildLegacyWrapper, buildManifest, migrateLegacyAdapter, runLegacySources };
if (require.main === module) main();
