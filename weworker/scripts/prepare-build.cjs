'use strict';

/**
 * prepare-build.cjs — 构建预处理脚本
 *
 * 职责：
 * 1. 读取并校验公开 build profile，可选叠加仓库外部 overlay
 * 2. 从各 adapter 的 manifest.json 筛选 adapter，输出完整 extension-dist
 * 3. 将 providers/defaultProvider 写入 build/.build-defines.json
 *
 * 用法：
 *   node scripts/prepare-build.cjs --profile public
 *   node scripts/prepare-build.cjs --profile internal --overlay ../../internal/config/build-overlay.json
 */

const fs = require('fs');
const path = require('path');
const { validateBuildProfile } = require('./build-profile-validator.cjs');
const {
  DEFAULT_ICON,
  buildRegistryFromManifests,
} = require('./adapter-registry-sync.cjs');
const {
  mergeBuildProfile,
  mergeExtensionManifest,
  parseBuildOptions,
  readJson,
} = require('./build-profile-overlay.cjs');

const WEWORKER_ROOT = path.resolve(__dirname, '..');
const PROFILE_PATH = path.resolve(WEWORKER_ROOT, 'build-profile.json');
const ADAPTERS_SRC_DIR = path.resolve(__dirname, '../../extension/adapters');
const BUILTIN_SRC_DIR = path.resolve(__dirname, '../../adapters');
const BUILTIN_DIST_DIR = path.resolve(WEWORKER_ROOT, 'build/builtin-adapters');
const BUILTIN_BUILD_MODULE = require('node:url').pathToFileURL(path.resolve(__dirname, '../../webcli/builtin-adapter-build.js')).href;
const ADAPTERS_DIST_DIR = path.resolve(WEWORKER_ROOT, 'build/adapters-dist');
const BUILD_DEFINES_PATH = path.resolve(WEWORKER_ROOT, 'build/.build-defines.json');
const EXTENSION_SRC_DIR = path.resolve(__dirname, '../../extension');
const EXTENSION_DIST_DIR = path.resolve(WEWORKER_ROOT, 'build/extension-dist');

/** 递归复制文件/目录（Windows 上对子目录用 copyFileSync 会 EPERM） */
function copyTreeSync(src, dest) {
  const stat = fs.lstatSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyTreeSync(path.resolve(src, name), path.resolve(dest, name));
    }
    return;
  }
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

async function main() {
  const { selectBuiltinAdapters, validateBuiltinOutput, writeBuiltinAdapters } = await import(BUILTIN_BUILD_MODULE);

  // ── Task 2.1: 读取、合并并校验 profile ──

  let options;
  let profile;
  let overlay = {};
  try {
    options = parseBuildOptions(process.argv.slice(2));
    const baseProfile = readJson(PROFILE_PATH, 'build-profile.json');
    if (options.overlayPath) overlay = readJson(options.overlayPath, 'build overlay');
    profile = mergeBuildProfile(baseProfile, overlay);
  } catch (err) {
    console.error(`[prepare-build] ERROR: ${err.message}`);
    process.exit(1);
  }

  try {
    validateBuildProfile(profile);
  } catch (err) {
    console.error(`[prepare-build] ERROR: ${err.message}`);
    process.exit(1);
  }

  console.log(
    `[prepare-build] Profile "${options.profileName}" validated` +
    (options.overlayPath ? ` with overlay ${options.overlayPath}` : '') +
    '.',
  );

  // ── Task 2.2: Adapter 筛选逻辑（manifest.json 为唯一数据源） ──

  const requestedIds = profile.adapters;
  const selection = selectBuiltinAdapters({ names: requestedIds, builtinDir: BUILTIN_SRC_DIR, legacyDir: ADAPTERS_SRC_DIR });
  const filteredAdapters = selection.legacy.map(({ manifest }) => manifest);
  // Separate resources for host-managed packages. Never copy these into Extension.
  if (fs.existsSync(BUILTIN_DIST_DIR)) fs.rmSync(BUILTIN_DIST_DIR, { recursive: true, force: true });
  writeBuiltinAdapters({ selection, outputDir: BUILTIN_DIST_DIR, profile: options.profileName });
  validateBuiltinOutput(BUILTIN_DIST_DIR);

  // 重新生成输出，防止上一次 profile 的 Adapter 残留。
  if (fs.existsSync(ADAPTERS_DIST_DIR)) fs.rmSync(ADAPTERS_DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(ADAPTERS_DIST_DIR, { recursive: true });

  const filteredRegistry = buildRegistryFromManifests(filteredAdapters, { defaultIcon: DEFAULT_ICON, preserveOrder: true });
  // Generated resources must be byte-stable across profile preparation runs.
  delete filteredRegistry.updated_at;
  fs.writeFileSync(
    path.resolve(ADAPTERS_DIST_DIR, 'registry.json'),
    JSON.stringify(filteredRegistry, null, 2) + '\n',
    'utf-8'
  );

  // 复制对应的 adapter 目录（含 webcli-generated 等子目录）
  for (const entry of filteredAdapters) {
    const srcDir = path.resolve(ADAPTERS_SRC_DIR, entry.id);
    const destDir = path.resolve(ADAPTERS_DIST_DIR, entry.id);
    if (fs.existsSync(srcDir)) {
      copyTreeSync(srcDir, destDir);
    } else {
      console.warn(`[prepare-build] WARNING: adapter directory not found: ${srcDir}`);
    }
  }

  console.log(
    `[prepare-build] Adapter filtering complete: ${filteredAdapters.length} adapter(s) copied` +
    `, ${selection.packages.length} host-managed package(s)` +
    '.'
  );

  // 生成 adapters/index.json：扩展启动时据此初始化已安装 adapter ID 列表。
  // 缺失该文件会导致扩展无法发现任何 adapter（static direct 路由也不加载），
  // 所有工具退化到 page 路由。此前打包产物一直缺此文件。
  const adapterIds = filteredAdapters.map((entry) => entry.id).sort();
  fs.writeFileSync(
    path.resolve(ADAPTERS_DIST_DIR, 'index.json'),
    JSON.stringify(adapterIds, null, 2) + '\n',
    'utf-8'
  );

  // ── Task 2.3: 生成 .build-defines.json ──

  const buildDefines = {
    profile: options.profileName,
    providers: profile.providers,
    defaultProvider: profile.defaultProvider,
    commitHash: (() => {
      try {
        return require('child_process').execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
      } catch { return 'unknown'; }
    })(),
  };

  fs.mkdirSync(path.dirname(BUILD_DEFINES_PATH), { recursive: true });
  fs.writeFileSync(
    BUILD_DEFINES_PATH,
    JSON.stringify(buildDefines, null, 2) + '\n',
    'utf-8'
  );

  console.log(`[prepare-build] .build-defines.json written to ${BUILD_DEFINES_PATH}`);

  // ── Task 2.4: 生成完整扩展目录，不回写 extension 源文件 ──

  const MANIFEST_PATH = path.resolve(EXTENSION_SRC_DIR, 'manifest.json');
  const WEWORKER_PKG_PATH = path.resolve(WEWORKER_ROOT, 'package.json');
  const weworkerPkg = JSON.parse(fs.readFileSync(WEWORKER_PKG_PATH, 'utf-8'));
  const sourceManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  const generatedManifest = mergeExtensionManifest(sourceManifest, overlay.extension, weworkerPkg.version);

  if (fs.existsSync(EXTENSION_DIST_DIR)) fs.rmSync(EXTENSION_DIST_DIR, { recursive: true, force: true });
  copyTreeSync(EXTENSION_SRC_DIR, EXTENSION_DIST_DIR);
  const extensionAdaptersDir = path.resolve(EXTENSION_DIST_DIR, 'adapters');
  if (fs.existsSync(extensionAdaptersDir)) fs.rmSync(extensionAdaptersDir, { recursive: true, force: true });
  copyTreeSync(ADAPTERS_DIST_DIR, extensionAdaptersDir);
  fs.writeFileSync(
    path.resolve(EXTENSION_DIST_DIR, 'manifest.json'),
    JSON.stringify(generatedManifest, null, 2) + '\n',
    'utf-8',
  );
  console.log(`[prepare-build] Extension written to ${EXTENSION_DIST_DIR}`);

  // ── Task 2.5: 校验 Renderer 版本，不回写源文件 ──

  const RENDERER_PKG_PATH = path.resolve(WEWORKER_ROOT, 'renderer/package.json');
  const rendererPkg = JSON.parse(fs.readFileSync(RENDERER_PKG_PATH, 'utf-8'));

  if (rendererPkg.version !== weworkerPkg.version) {
    console.error(
      `[prepare-build] ERROR: renderer/package.json version ${rendererPkg.version} does not match ` +
      `weworker/package.json version ${weworkerPkg.version}.`,
    );
    process.exit(1);
  }
  console.log(`[prepare-build] Source versions are consistent at ${weworkerPkg.version}.`);

  console.log('[prepare-build] Done.');

}
main().catch((error) => { console.error(`[prepare-build] ERROR: ${error.message}`); process.exitCode = 1; });
