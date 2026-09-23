import { createHash } from "crypto";
import { unzipSync } from "fflate";

const MAX_FILES = 512;
const MAX_FILE_SIZE = 16 * 1024 * 1024;
const MAX_PACKAGE_SIZE = 64 * 1024 * 1024;

export function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function safeName(name) {
  return name && !name.startsWith("/") && !name.includes("\\") && !name.split("/").includes("..") && !name.includes("\0");
}

function hubId(value, prefix) {
  if (!new RegExp(`^${prefix}-[abcdefghjkmnpqrstuvwxyz23456789]{8}$`).test(String(value || ""))) throw new Error(`Invalid ${prefix} Hub ID.`);
}

function domain(value) {
  const text = String(value || "");
  if (text !== text.toLowerCase() || text.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(text)) throw new Error("Invalid site domain.");
}

export function readAdapt(bytes) {
  const input = Buffer.from(bytes);
  if (input.length > MAX_PACKAGE_SIZE) throw new Error(".adapt package exceeds 64 MB.");
  let archive;
  try { archive = unzipSync(input); } catch { throw new Error("Invalid .adapt ZIP archive."); }
  const entries = Object.entries(archive).filter(([name]) => !name.endsWith("/"));
  if (!entries.length || entries.length > MAX_FILES) throw new Error("Invalid .adapt file count.");
  for (const [name, content] of entries) {
    if (!safeName(name) || content.length > MAX_FILE_SIZE) throw new Error(`Unsafe .adapt entry: ${name}`);
  }
  const manifestBytes = archive["manifest.json"];
  if (!manifestBytes) throw new Error(".adapt package is missing manifest.json.");
  let manifest;
  try { manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8")); } catch { throw new Error("manifest.json is not valid JSON."); }
  if (!["site", "base", "command"].includes(manifest.scope)) throw new Error("manifest.scope must be site, base, or command.");
  if ("schema_version" in manifest) throw new Error("Hub manifest must not declare schema_version.");
  if ("adapter_type" in manifest || "entry" in manifest) throw new Error("Hub manifest must not use legacy root execution fields.");
  if (Object.keys(archive).some((name) => name.endsWith("toolkit_runtime.py"))) throw new Error("Hub packages must not duplicate toolkit_runtime.py.");
  if (manifest.scope === "command") {
    if (!manifest.site?.hub_id || !manifest.site?.base_hash || !manifest.command?.hub_id || !manifest.command?.module) throw new Error("Command package metadata is incomplete.");
    hubId(manifest.site.hub_id, "s"); hubId(manifest.command.hub_id, "c"); domain(manifest.site.domain);
    if (!safeName(manifest.command.module) || !["extension", "toolkit"].includes(manifest.command.runtime)) throw new Error("Invalid command metadata.");
    const module = archive[manifest.command.module];
    if (!module || digest(module) !== manifest.command.artifact_hash) throw new Error("Command artifact hash mismatch.");
    if (entries.some(([name]) => !["manifest.json", manifest.command.module].includes(name))) throw new Error("Command package contains unexpected files.");
  } else if (!manifest.hub_id || !manifest.domain || !manifest.base_hash || !manifest.runtimes) {
    throw new Error("Site package metadata is incomplete.");
  } else {
    hubId(manifest.hub_id, "s"); domain(manifest.domain);
    const names = new Set();
    for (const command of manifest.tools || []) {
      hubId(command.hub_id, "c");
      if (!safeName(command.module) || !["extension", "toolkit"].includes(command.runtime) || names.has(command.command_name)) throw new Error("Invalid or duplicate command metadata.");
      names.add(command.command_name);
      if (!archive[command.module] || digest(archive[command.module]) !== command.artifact_hash) throw new Error(`Command artifact hash mismatch: ${command.command_name}`);
    }
  }
  return { manifest, files: Object.fromEntries(entries.map(([name, content]) => [name, Buffer.from(content)])), sha256: digest(input) };
}
