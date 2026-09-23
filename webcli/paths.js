/**
 * Shared Adapter roots for the desktop host, Bridge and standalone WebCLI.
 * Legacy Extension roots remain explicit compatibility inputs during migration.
 */
import { existsSync, lstatSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export function isValidAdapterProfile(profile) {
  return typeof profile === "string" && /^[a-z0-9][a-z0-9_-]*$/.test(profile)
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(profile);
}

function samePath(left, right) {
  const a = resolve(left);
  const b = resolve(right);
  return a === b || (process.platform === "win32" && a.toLowerCase() === b.toLowerCase());
}

export function resolveExtensionDir({ env = process.env, baseDir = moduleDir } = {}) {
  if (env.WEWORKER_RESOURCES_PATH) return resolve(env.WEWORKER_RESOURCES_PATH, "extension");
  const prepared = resolve(baseDir, "../weworker/build/extension-dist");
  const checkoutMarker = resolve(baseDir, "../weworker/build-profile.json");
  // A checkout must use its generated profile output. A stale copy bundled for
  // npm must never substitute for the missing result of `prepare`.
  if (existsSync(checkoutMarker)) {
    if (existsSync(prepared)) return prepared;
    throw new Error("Run the profile prepare command before using Extension Adapter resources.");
  }
  const bundled = resolve(baseDir, "extension");
  if (existsSync(bundled)) return bundled;
  const sibling = resolve(baseDir, "../extension");
  return sibling;
}

/** Legacy built-in source. New package consumers use resolveBuiltinAdaptersDir. */
export function resolveAdaptersDir() {
  return resolve(resolveExtensionDir(), "adapters");
}

export function resolveBuiltinAdaptersDir({ env = process.env, baseDir = moduleDir } = {}) {
  if (env.WEWORKER_BUILTIN_ADAPTERS_DIR) return resolve(env.WEWORKER_BUILTIN_ADAPTERS_DIR);
  // A packaged host has a fixed resource root, even if the installation is broken.
  if (env.WEWORKER_RESOURCES_PATH) return resolve(env.WEWORKER_RESOURCES_PATH, "adapters");
  const prepared = resolve(baseDir, "../weworker/build/builtin-adapters");
  const checkoutMarker = resolve(baseDir, "../weworker/build-profile.json");
  if (existsSync(checkoutMarker)) {
    if (existsSync(join(prepared, ".profile.json"))) return prepared;
    throw new Error("Run the profile prepare command before using built-in Adapters.");
  }
  const candidates = [
    resolve(baseDir, "adapters"),
    resolve(baseDir, "../adapters"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || resolve(baseDir, "../adapters");
}

/** A stable write root. Existing legacy directories never redirect new installs. */
export function resolveUserAdaptersDir({ env = process.env, home = homedir() } = {}) {
  const hostRoot = env.WEWORKER_USER_ADAPTERS_DIR;
  const cliRoot = env.WEBCLI_ADAPTERS_DIR;
  if (hostRoot && cliRoot && !samePath(hostRoot, cliRoot)) {
    throw new Error("Conflicting host and CLI Adapter directory overrides.");
  }
  if (hostRoot || cliRoot) return resolve(hostRoot || cliRoot);
  const profile = resolveAdapterProfile(env);
  const root = join(home, ".weworker", "adapters");
  return resolve(profile === "public" ? root : join(root, ".profiles", profile));
}

function readProfileMetadata(metadataPath) {
  const stat = lstatSync(metadataPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Built-in Adapter profile metadata must be a regular file.");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (metadata?.schema_version !== 1 || !isValidAdapterProfile(metadata.profile)
      || !Array.isArray(metadata.adapters) || !Array.isArray(metadata.legacy)) {
    throw new Error("Invalid built-in Adapter profile metadata.");
  }
  return metadata;
}

function assertExplicitRootProfile(userDir, profile) {
  const markerPath = join(userDir, ".adapter-profile.json");
  if (!existsSync(markerPath)) return;
  const stat = lstatSync(markerPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Adapter root profile marker must be a regular file.");
  let marker;
  try { marker = JSON.parse(readFileSync(markerPath, "utf8")); }
  catch { throw new Error("Invalid Adapter root profile marker."); }
  if (!isValidAdapterProfile(marker?.profile)) throw new Error("Invalid Adapter root profile marker.");
  if (marker.profile !== profile) throw new Error("This user Adapter root belongs to a different profile.");
}

export function resolveAdapterProfile(env = process.env, builtinDir = resolveBuiltinAdaptersDir({ env })) {
  const metadataPath = join(builtinDir, ".profile.json");
  let builtProfile;
  if (existsSync(metadataPath)) {
    builtProfile = readProfileMetadata(metadataPath).profile;
  } else if (env.WEWORKER_RESOURCES_PATH) {
    throw new Error("Packaged Adapter profile metadata is missing.");
  }
  if (builtProfile && env.WEWORKER_BUILD_PROFILE && env.WEWORKER_BUILD_PROFILE !== builtProfile) {
    throw new Error("Adapter build profile does not match the host profile.");
  }
  const profile = builtProfile || env.WEWORKER_BUILD_PROFILE || "public";
  if (!isValidAdapterProfile(profile)) throw new Error("Invalid Adapter profile.");
  return profile;
}

export function resolveAdapterPaths({ env = process.env, home = homedir(), baseDir = moduleDir, builtinDir, userDir: explicitUserDir } = {}) {
  if (explicitUserDir !== undefined) env = { ...env, WEWORKER_USER_ADAPTERS_DIR: explicitUserDir, WEBCLI_ADAPTERS_DIR: explicitUserDir };
  const resolvedBuiltinDir = builtinDir === undefined ? resolveBuiltinAdaptersDir({ env, baseDir }) : resolve(builtinDir);
  const profile = resolveAdapterProfile(env, resolvedBuiltinDir);
  env = { ...env, WEWORKER_BUILD_PROFILE: profile, WEWORKER_BUILTIN_ADAPTERS_DIR: resolvedBuiltinDir };
  const userDir = resolveUserAdaptersDir({ env, home });
  assertExplicitRootProfile(userDir, profile);
  // An explicit install root isolates all writable state, including test fixtures.
  const overrideRoot = env.WEWORKER_USER_ADAPTERS_DIR || env.WEBCLI_ADAPTERS_DIR;
  const dataRoot = resolve(env.WEWORKER_ADAPTER_DATA_DIR || (overrideRoot ? join(userDir, ".host-data") : join(home, ".weworker")));
  return Object.freeze({
    profile,
    builtinDir: resolvedBuiltinDir,
    userDir,
    workspaceDir: join(dataRoot, "adapter-workspaces", profile),
    stateDir: join(dataRoot, "adapter-state", profile),
    packageDir: join(dataRoot, "adapter-packages", profile),
    cacheDir: join(dataRoot, "adapter-cache", profile),
    // Migration inventory only; never automatically scanned as an active source.
    legacyUserDir: join(home, ".webcli", "adapters"),
  });
}
