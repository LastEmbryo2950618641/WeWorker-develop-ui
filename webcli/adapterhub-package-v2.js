/**
 * v2 Adapter 包（.adapt）读取与校验 — webcli 侧
 * 规范：docs/adapter_package_spec.md；zip 层与禁入文件规则与 adapterhub/lib/adapt-package.js 对齐。
 * v1（scope site/command/base）冻结存量走 adapterhub-package.js 的 readAdapt。
 */

import { createHash } from "crypto";
import { unzipSync } from "fflate";
import path from "path";
import { validateV2Manifest } from "./adapter-package-v2.js";

const MAX_FILES = 512;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const V2_FORBIDDEN_FILES = new Set([
  "toolkit_runtime.py", "toolkit.py", "requirements.txt",
  "SKILL.md", "SKILL.generated.md", "index.js",
  "WEBCLI_KNOWLEDGE.json", "WEBCLI_KNOWLEDGE.md", "wecli.generated.json",
]);

function safePath(name) {
  if (typeof name !== "string" || !name || name.includes("\\") || path.posix.isAbsolute(name)) return false;
  const normalized = path.posix.normalize(name);
  return normalized === name && normalized !== ".." && !normalized.startsWith("../") && !normalized.includes("/../");
}

export function readAdapterPackage(input) {
  const bytes = Buffer.from(input);
  let archive;
  try { archive = unzipSync(new Uint8Array(bytes)); } catch { throw new Error("Invalid .adapt ZIP archive."); }
  const entries = Object.entries(archive).filter(([name]) => !name.endsWith("/"));
  if (!entries.length || entries.length > MAX_FILES) throw new Error("Invalid .adapt file count.");
  let total = 0;
  const files = new Map();
  for (const [name, content] of entries) {
    if (!safePath(name)) throw new Error(`Unsafe package path: ${name}`);
    total += content.length;
    if (total > MAX_EXPANDED_BYTES) throw new Error("Adapt package is too large.");
    files.set(name, Buffer.from(content));
  }
  const manifestBytes = files.get("manifest.json");
  if (!manifestBytes) throw new Error(".adapt package is missing manifest.json.");
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString("utf8")); } catch { throw new Error("manifest.json is not valid JSON."); }
  if (manifest?.schema_version !== 2) throw new Error("Adapter package requires schema_version 2 (v1 packages are frozen; validate legacy files with the v1 reader).");
  validateV2Manifest(manifest, manifest.name);
  for (const command of manifest.commands) {
    if (!files.has(command.module)) throw new Error(`Missing command module: ${command.module}`);
  }
  const runtimes = new Set(manifest.commands.map((c) => c.runtime));
  const roots = new Set(["manifest.json", ...runtimes]);
  for (const name of files.keys()) {
    if (name.split("/").includes("__pycache__")) throw new Error(`Forbidden directory entry: ${name}`);
    const base = name.split("/").pop();
    if (V2_FORBIDDEN_FILES.has(base)) throw new Error(`Forbidden file: ${name}`);
    if (/\.generated\.(js|py|md|txt)$/.test(base)) throw new Error(`Forbidden generated file: ${name}`);
    const [root, sub] = name.split("/");
    if (!roots.has(root)) throw new Error(`Unexpected package root entry: ${root}`);
    if (root !== "manifest.json" && sub !== "commands" && sub !== "internal") {
      throw new Error(`Runtime "${root}" may only contain commands/ and internal/`);
    }
  }
  return {
    manifest,
    files,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    expandedBytes: total,
  };
}
