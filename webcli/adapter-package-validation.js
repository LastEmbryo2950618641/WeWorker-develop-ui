/**
 * Adapter Package v2 — 校验、发现与解析
 *
 * Shared contract: docs/adapter_architecture_unification.md (schema_version=2).
 * 结构：adapters/<name>/{manifest.json, extension/{commands,internal}, wewright/{commands,internal}}
 *
 * 两级校验：
 * - validateV2Manifest：结构校验（加载路径用，快）
 * - validateV2AdapterDir：完整包校验（adapter validate / hub 上传用，含文件树封闭性与禁入文件）
 *
 * 存量 v1（extension/adapters、五文件 toolkit）冻结只读，本模块只发现 schema_version=2 的目录。
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from "fs";
import { basename, join, resolve, sep } from "path";


const RUNTIMES = ["extension", "wewright"];
const COMMAND_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FORBIDDEN_MANIFEST_FIELDS = [
  "adapter_type",
  "entry",
  "scope",
  "hub_id",
  "support_files",
  "tool_execution",
  "detail_description",
  "author",
];
// spec §7 禁入文件（相对 adapter 根或任意子路径匹配）
const FORBIDDEN_FILE_NAMES = new Set([
  "toolkit_runtime.py",
  "toolkit.py",
  "requirements.txt",
  "SKILL.md",
  "SKILL.generated.md",
  "index.js",
  "WEBCLI_KNOWLEDGE.json",
  "WEBCLI_KNOWLEDGE.md",
  "wecli.generated.json",
]);

function fail(adapterName, message) {
  throw new Error(`Adapter "${adapterName}": ${message}`);
}

function isRegularFile(path) {
  const stat = lstatSync(path);
  return !stat.isSymbolicLink() && stat.isFile();
}

export function validateAgentGuidance(bytes) {
  let guidance;
  try { guidance = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('Adapter guidance must be UTF-8 text.'); }
  if (bytes.length > 20_000 || !guidance.trim() || /^---\s*(?:\r?\n|$)/.test(guidance)
    || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(guidance)) {
    throw new Error('Adapter guidance must be non-empty Markdown without Skill frontmatter or control characters (20 KB max).');
  }
  return guidance;
}

/** adapter name 不做命名正则，仅要求跨平台目录名可用（spec §3）。 */
function validAdapterName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    !/[\x00-\x1f\x7f]/.test(name) &&
    !/[/\\:*?"<>|\s]/.test(name) &&
    !name.startsWith(".") &&
    !name.endsWith(".") &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) &&
    name.length <= 128 &&
    name !== "." &&
    name !== ".."
  );
}

/**
 * 结构校验（不触盘，除可选的 module 文件存在性由调用方决定）。
 * @returns {{ name, manifest, commands: Array<{id,runtime,module,description,safety,schema,name}> }}
 */
export function validateV2Manifest(manifest, directoryName = "?") {
  const adapterName = String(manifest?.name || directoryName);
  if (manifest?.schema_version !== 2) fail(adapterName, "schema_version must be 2.");
  if (!validAdapterName(manifest?.name)) fail(adapterName, "invalid adapter name.");
  if (directoryName !== "?" && manifest.name !== directoryName) {
    fail(adapterName, `name must match its directory name ("${directoryName}").`);
  }
  for (const field of FORBIDDEN_MANIFEST_FIELDS) {
    if (field in manifest) fail(adapterName, `forbidden field "${field}" (v1 legacy).`);
  }
  if (typeof manifest.version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(manifest.version)) {
    fail(adapterName, "version must be a semantic version.");
  }
  if (typeof manifest.description !== "string" || !manifest.description.trim()) {
    fail(adapterName, "description is required.");
  }
  if (manifest.discovery_terms !== undefined && (!Array.isArray(manifest.discovery_terms)
    || manifest.discovery_terms.length > 16 || manifest.discovery_terms.some((term) =>
      typeof term !== "string" || !term.trim() || term.length > 80 || /[\x00-\x1f\x7f]/.test(term)))) {
    fail(adapterName, "discovery_terms must contain at most 16 non-empty short phrases.");
  }
  if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
    fail(adapterName, "commands must be a non-empty array.");
  }

  const runtimeAllowedHosts = manifest.runtime_allowed_hosts;
  if (runtimeAllowedHosts !== undefined
    && (!Array.isArray(runtimeAllowedHosts) || runtimeAllowedHosts.length > 64)) {
    fail(adapterName, "runtime_allowed_hosts must be an array of at most 64 hosts.");
  }
  for (const host of runtimeAllowedHosts || []) {
    if (typeof host !== "string" || !host.trim() || /[\s,*?"<>|]/.test(host)) {
      fail(adapterName, "runtime_allowed_hosts must contain non-empty host strings.");
    }
  }

  const runtimesPresent = new Set();
  const ids = new Set();
  const callIds = new Set();
  const legacyCallNames = new Set();
  const match = manifest.match;
  const commands = manifest.commands.map((command) => {
    const id = String(command?.id || "");
    if (!COMMAND_ID_RE.test(id)) fail(adapterName, `invalid command id "${id}" (kebab-case required).`);
    if (ids.has(id)) fail(adapterName, `duplicate command id "${id}".`);
    ids.add(id);
    if (callIds.has(id)) fail(adapterName, 'Command name conflicts with an alias.');
    callIds.add(id);
    if (command.aliases !== undefined && (!Array.isArray(command.aliases) || command.aliases.length > 64)) {
      fail(adapterName, 'Command aliases must be an array of at most 64 local command names.');
    }
    for (const alias of command.aliases || []) {
      // Local names cannot claim another package or collide with longest-name routing.
      if (typeof alias !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(alias) || callIds.has(alias)) {
        fail(adapterName, 'Invalid or conflicting command alias.');
      }
      callIds.add(alias);
    }
    if (command.legacyNames !== undefined && (!Array.isArray(command.legacyNames) || command.legacyNames.length > 64)) {
      fail(adapterName, 'Command legacy names must be an array of at most 64 full tool names.');
    }
    for (const legacyName of command.legacyNames || []) {
      const normalized = typeof legacyName === 'string' ? legacyName.toLowerCase() : legacyName;
      if (typeof legacyName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(legacyName) || !legacyName.includes('.')
        || legacyName.startsWith(manifest.name + '.') || legacyName === `${manifest.name}.${id}` || legacyCallNames.has(normalized)) {
        fail(adapterName, 'Command legacy names must be non-conflicting full cross-prefix tool names.');
      }
      legacyCallNames.add(normalized);
    }
    if (!RUNTIMES.includes(command?.runtime)) fail(adapterName, `command "${id}": runtime must be extension|wewright.`);
    if (command.execution !== undefined && (command.runtime !== 'extension' || !command.execution
      || command.execution.type !== 'api' || command.execution.runtime !== 'background'
      || Object.keys(command.execution).some((key) => !['type', 'runtime'].includes(key)))) {
      fail(adapterName, 'Command execution must be an Extension API background declaration.');
    }
    for (const field of ['routeDomain', 'tabDomain', 'excludeTabDomain']) {
      const value = command[field];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !/^[A-Za-z0-9*_.-]+$/.test(value) || !match?.includes(value)) {
        fail(adapterName, `Command "${id}" route field "${field}" must be a declared match host.`);
      }
    }
    if (command.pageRoute !== undefined) {
      const route = command.pageRoute;
      let url;
      try { url = new URL(route?.origin + route?.pathname); } catch { /* Rejected below. */ }
      if (!route || typeof route !== 'object' || Array.isArray(route)
        || Object.keys(route).some(key => !['origin', 'pathname'].includes(key))
        || typeof route.pathname !== 'string' || !/^\/(?!\/)/.test(route.pathname)
        || command.runtime !== 'extension' || command.execution || command.safety === 'write'
        || !url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || url.origin !== route.origin || url.pathname !== route.pathname || url.search || url.hash
        || !match?.some(host => url.hostname === host || (host.startsWith('*.') && url.hostname.endsWith(host.slice(1))))
        || (command.tabDomain && url.hostname !== command.tabDomain)) {
        fail(adapterName, `Command "${id}" pageRoute must be an exact declared HTTP(S) origin and pathname for a foreground read command.`);
      }
    }
    if (command.pageStrategy !== undefined && (!command.pageRoute || !['UI_SELECTOR', 'DOM_STATE', 'INTERCEPT'].includes(command.pageStrategy))) fail(adapterName, 'pageStrategy must name a supported strategy with pageRoute.');
    runtimesPresent.add(command.runtime);
    const ext = command.runtime === "extension" ? "js" : "py";
    const expectedModule = `${command.runtime}/commands/${id}.${ext}`;
    if (command?.module !== expectedModule) {
      fail(adapterName, `command "${id}": module must be "${expectedModule}".`);
    }
    if (typeof command?.description !== "string" || !command.description.trim()) {
      fail(adapterName, `command "${id}": description is required.`);
    }
    if (command?.safety != null && !["read", "write"].includes(command.safety)) {
      fail(adapterName, `command "${id}": safety must be read|write.`);
    }
    if (command?.requires_confirmation !== undefined && typeof command.requires_confirmation !== 'boolean') {
      fail(adapterName, `command "${id}": requires_confirmation must be a boolean.`);
    }
    const schema = command?.schema;
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
      fail(adapterName, `command "${id}": schema is required (JSON Schema object).`);
    }
    if (schema.properties != null && (typeof schema.properties !== "object" || Array.isArray(schema.properties))) {
      fail(adapterName, `command "${id}": schema.properties must be an object.`);
    }
    return { ...command, safety: command.safety || "read", name: `${manifest.name}.${id}` };
  });

  const hasExtension = runtimesPresent.has("extension");
  if (hasExtension) {
    if (!Array.isArray(match) || match.length === 0 || match.some((d) => typeof d !== "string" || !d.trim())) {
      fail(adapterName, "match (non-empty domain array) is required when extension commands exist.");
    }
  } else if (match != null && (!Array.isArray(match) || match.length > 0)) {
    fail(adapterName, "match is forbidden for pure wewright adapters.");
  }

  return { name: manifest.name, manifest, commands };
}

function walkFiles(root, relative = "", out = []) {
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) out.push({ rel, symlink: true });
    else if (entry.isDirectory()) walkFiles(root, rel, out);
    else if (entry.isFile()) out.push({ rel, symlink: false });
  }
  return out;
}

/**
 * 完整包校验：结构 + 文件树封闭集合 + 禁入文件（spec §2/§7）。
 * @param {string} adapterRoot adapter 目录（名为 <name>）
 */
export function validateV2AdapterDir(adapterRoot) {
  if (!existsSync(adapterRoot) || lstatSync(adapterRoot).isSymbolicLink() || !lstatSync(adapterRoot).isDirectory()) {
    fail("package", "root must be a regular directory.");
  }
  const directoryName = basename(resolve(adapterRoot));
  const manifestPath = join(adapterRoot, "manifest.json");
  if (!existsSync(manifestPath) || !isRegularFile(manifestPath)) {
    fail(directoryName, "manifest.json must be a regular file.");
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    fail(directoryName, "manifest.json is not valid JSON.");
  }
  const { name, commands } = validateV2Manifest(manifest, directoryName);

  const files = walkFiles(adapterRoot);
  const problems = [];
  for (const { rel, symlink } of files) {
    if (symlink) problems.push(`symlink not allowed: ${rel}`);
    const base = rel.split("/").pop();
    if (FORBIDDEN_FILE_NAMES.has(base)) problems.push(`forbidden file: ${rel}`);
    if (rel.split("/").includes("__pycache__")) problems.push(`forbidden directory entry: ${rel}`);
    if (/\.generated\.(js|py|md|txt)$/.test(base)) problems.push(`forbidden generated file: ${rel}`);
  }
  if (problems.length > 0) fail(name, problems.join("; "));
  const guidancePath = join(adapterRoot, 'guidance.md');
  if (existsSync(guidancePath)) {
    if (!isRegularFile(guidancePath)) fail(name, 'guidance.md must be a regular file.');
    try { validateAgentGuidance(readFileSync(guidancePath)); }
    catch (error) { fail(name, error.message); }
  }

  // 封闭集合：根级仅 manifest.json、可选 guidance.md 与存在命令的 runtime 目录。
  const topEntries = readdirSync(adapterRoot, { withFileTypes: true }).map((e) => e.name);
  const runtimesWithCommands = new Set(commands.map((c) => c.runtime));
  for (const entry of topEntries) {
    if (entry === "manifest.json" || entry === "guidance.md") continue;
    if (!runtimesWithCommands.has(entry)) {
      fail(name, `unexpected root entry "${entry}" (runtime dir without commands or unknown file).`);
    }
    for (const sub of readdirSync(join(adapterRoot, entry), { withFileTypes: true })) {
      if (sub.name !== "commands" && sub.name !== "internal") {
        fail(name, `runtime "${entry}" may only contain commands/ and internal/, found "${sub.name}".`);
      }
    }
  }
  for (const runtime of runtimesWithCommands) {
    if (!topEntries.includes(runtime)) fail(name, `missing runtime directory "${runtime}/".`);
    const commandsDir = join(adapterRoot, runtime, "commands");
    if (!existsSync(commandsDir)) fail(name, `missing "${runtime}/commands/".`);
    // commands/ 与 internal/ 内文件命名（spec §3/§5）：命令=kebab；internal 按语言习惯不强校验
    for (const f of readdirSync(commandsDir)) {
      if (!/\.(js|py)$/.test(f)) fail(name, `unexpected file in ${runtime}/commands/: ${f}`);
    }
  }
  // module 文件必须真实存在
  for (const command of commands) {
    const modulePath = join(adapterRoot, command.module);
    if (!existsSync(modulePath) || !isRegularFile(modulePath)) {
      fail(name, `command "${command.id}": module file missing: ${command.module}`);
    }
  }

  return { name, root: resolve(adapterRoot), manifest, commands };
}
