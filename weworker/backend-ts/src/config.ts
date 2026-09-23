import fs from 'node:fs'

import path from 'node:path'

import os from 'node:os'
import {
  DEFAULT_RESOURCE_PREVIEW_EXTENSIONS,
  getEffectivePreviewExtensions,
  getPreviewExtensionSet,
  normalizePreviewExtensions,
} from './resource-preview-extensions.js'

import { createLogger } from './logger.js'

import {

  applySecrets,

  clearSecretsOnDisk,

  collectPlaintextSecretsFromRaw,

  extractSecrets,

  rawFileHasPlaintextSecrets,

} from './settings-secrets.js'

import {

  decryptSecrets,

  encryptSecrets,

  initSecretStore,

  isSecretStoreReady,

} from './secret-store.js'

import {

  DEFAULT_DOWNLOAD_SUBDIRECTORY,

  normalizeDownloadSubdirectory,

  resolveDownloadDirectory,

} from './download-directory.js'

import {
  normalizeUserDirectoryBlacklist,
  countInvalidBlacklistEntries,
  type UserDirectoryBlacklistEntry,
} from './user-directory-blacklist.js'
import {
  CORE_STYLE_ID,
  DEFAULT_STYLE_ID,
  migrateLegacyDefaultRole,
  normalizeZcfCustomRoles,
  normalizeZcfEnabledRoles,
  normalizeZcfMode,
  type ZcfCustomRole,
} from './zcf-role-settings.js'
import { DEFAULT_CONTEXT_LIMIT, normalizeContextLimit } from './context-window.js'



const log = createLogger('config')



const CONFIG_DIR = path.join(os.homedir(), '.weworker')

const DEFAULT_USER_DIRECTORY = path.join(CONFIG_DIR, 'user-files')

const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json')

const DEFAULT_MAX_CHAT_ATTACHMENTS = 60

const MIN_CHAT_ATTACHMENTS = 1

const MAX_CHAT_ATTACHMENTS = 200
const DEFAULT_PASTE_TEXT_ATTACHMENT_THRESHOLD = 20000
const MIN_PASTE_TEXT_ATTACHMENT_THRESHOLD = 1000
const MAX_PASTE_TEXT_ATTACHMENT_THRESHOLD = 200000
const DEFAULT_WELCOME_FEATURED_SITE_LIMIT = 50
const MIN_WELCOME_FEATURED_SITE_LIMIT = 1
const MAX_WELCOME_FEATURED_SITE_LIMIT = 50



export interface QQChannelConfig {

  enabled: boolean

  app_id: string

  app_secret: string

  owner_user_id: string

  owner_permission_level: OwnerPermissionLevel

}



export type OwnerPermissionLevel = 'qa_only' | 'no_bash' | 'full'



export interface WeixinChannelConfig {

  enabled: boolean

  token: string       // bot_token from QR login

  base_url: string    // iLink API base URL

  owner_user_id: string

  owner_permission_level: OwnerPermissionLevel

}



export interface WecomChannelConfig {

  enabled: boolean

  bot_id: string

  secret: string

  owner_user_id: string

  owner_permission_level: OwnerPermissionLevel

}



export interface ChannelsConfig {

  qq: QQChannelConfig

  weixin: WeixinChannelConfig

  wecom: WecomChannelConfig

}



export interface Settings {

  // Active provider (which one is currently in use)

  active_provider: string

  // Active key/url/model (derived from active provider, used by agent)

  api_key: string

  base_url: string

  model: string

  context_limit: number

  // Per-provider stored configs

  api_key_anthropic: string

  model_anthropic: string

  context_limit_anthropic: number

  api_key_glm: string

  model_glm: string

  context_limit_glm: number

  api_key_deepseek: string

  model_deepseek: string

  context_limit_deepseek: number

  api_key_custom: string

  model_custom: string

  context_limit_custom: number

  base_url_custom: string

  openai_base_url_custom: string

  custom_auth_type: import('./anthropic-auth.js').AnthropicAuthType

  channels: ChannelsConfig

  // Per-site tool enable/disable toggles (adapter id → state)

  // Missing keys default to true (enabled + visible)

  // true = enabled + visible, 'hidden' = enabled but not shown on welcome page, false = fully disabled

  site_toggles: Record<string, boolean | 'hidden'>

  // Per-site custom test prompts (adapter id → string[])

  // null = use registry defaults; string[] = user-managed (fully overrides registry)

  custom_test_prompts: Record<string, string[] | null>

  // Label color → custom name mapping

  label_names: Record<string, string>

  user_directory: string

  download_directory: string

  max_chat_attachments: number
  paste_text_attachment_threshold: number
  welcome_featured_site_limit: number
  // null = built-in defaults; non-null array replaces defaults entirely
  resource_preview_extensions: string[] | null
  user_directory_blacklist: UserDirectoryBlacklistEntry[]
  open_browser_allowed_origins: string[]

  /** P2 API 查询路由的 LLM 分类层开关（默认开；env WEWORKER_LLM_ROUTE=1|0 可覆盖）。 */
  api_query_llm_route: boolean

  /** ZCF output style id synced from zcf templates; empty = no extra role prompt */
  zcf_default_role: string

  /** ZCF workflow mode id: direct (默认) | auto-plan (自动规划) */
  zcf_default_mode: string

  /** Language used when syncing ZCF templates */
  zcf_lang: 'zh-CN' | 'en'

  /** Built-in + custom role ids shown in chat picker */
  zcf_enabled_roles: string[]

  /** User-defined ZCF roles (id, label, prompt) */
  zcf_custom_roles: ZcfCustomRole[]
}



interface EncryptedSettingsBlob {

  v: 1

  fields: Record<string, string>

}



declare const __BUILD_DEFAULT_PROVIDER__: string



const _defaultProvider = typeof __BUILD_DEFAULT_PROVIDER__ !== 'undefined'

  ? __BUILD_DEFAULT_PROVIDER__

  : 'anthropic'



const DEFAULTS: Settings = {

  active_provider: _defaultProvider,

  api_key: '',

  base_url: 'https://api.anthropic.com',

  model: 'claude-sonnet-4-6',

  context_limit: DEFAULT_CONTEXT_LIMIT,

  api_key_anthropic: '',

  model_anthropic: 'claude-sonnet-4-6',

  context_limit_anthropic: DEFAULT_CONTEXT_LIMIT,

  api_key_glm: '',

  model_glm: 'glm-5.2',

  context_limit_glm: DEFAULT_CONTEXT_LIMIT,

  api_key_deepseek: '',

  model_deepseek: 'deepseek-v4-flash',

  context_limit_deepseek: DEFAULT_CONTEXT_LIMIT,

  api_key_custom: '',

  model_custom: '',

  context_limit_custom: DEFAULT_CONTEXT_LIMIT,

  base_url_custom: '',

  api_query_llm_route: true,

  openai_base_url_custom: '',

  custom_auth_type: 'auth_token',

  channels: {

    qq: { enabled: false, app_id: '', app_secret: '', owner_user_id: '', owner_permission_level: 'full' },

    weixin: { enabled: false, token: '', base_url: '', owner_user_id: '', owner_permission_level: 'full' },

    wecom: { enabled: false, bot_id: '', secret: '', owner_user_id: '', owner_permission_level: 'full' },

  },

  site_toggles: {},

  custom_test_prompts: {},

  label_names: {},

  user_directory: DEFAULT_USER_DIRECTORY,

  download_directory: DEFAULT_DOWNLOAD_SUBDIRECTORY,

  max_chat_attachments: DEFAULT_MAX_CHAT_ATTACHMENTS,
  paste_text_attachment_threshold: DEFAULT_PASTE_TEXT_ATTACHMENT_THRESHOLD,
  welcome_featured_site_limit: DEFAULT_WELCOME_FEATURED_SITE_LIMIT,
  resource_preview_extensions: null,
  user_directory_blacklist: [],
  open_browser_allowed_origins: [],

  zcf_default_role: CORE_STYLE_ID,

  zcf_default_mode: 'auto-plan',

  zcf_lang: 'zh-CN',

  zcf_enabled_roles: [CORE_STYLE_ID],

  zcf_custom_roles: [],
}



let _settings: Settings | null = null

let _settingsInitialized = false



function cloneDefaults(): Settings {

  return {

    ...DEFAULTS,

    channels: {

      qq: { ...DEFAULTS.channels.qq },

      weixin: { ...DEFAULTS.channels.weixin },

      wecom: { ...DEFAULTS.channels.wecom },

    },

    site_toggles: { ...DEFAULTS.site_toggles },

    custom_test_prompts: { ...DEFAULTS.custom_test_prompts },

    label_names: { ...DEFAULTS.label_names },
    open_browser_allowed_origins: [...DEFAULTS.open_browser_allowed_origins],

  }

}



function readRawSettingsFile(): Record<string, unknown> | null {

  try {

    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8')

    const data = JSON.parse(raw)

    return data && typeof data === 'object' && !Array.isArray(data)

      ? data as Record<string, unknown>

      : null

  } catch {

    return null

  }

}



function normalizeOwnerPermissionLevel(value: unknown): OwnerPermissionLevel {
  const next = String(value ?? '').trim()
  if (next === 'qa_only' || next === 'no_bash' || next === 'full') return next
  return 'full'
}

function normalizeChannelsConfig(channels: ChannelsConfig): ChannelsConfig {
  return {
    qq: {
      ...channels.qq,
      owner_permission_level: normalizeOwnerPermissionLevel(channels.qq.owner_permission_level),
    },
    weixin: {
      ...channels.weixin,
      owner_permission_level: normalizeOwnerPermissionLevel(channels.weixin.owner_permission_level),
    },
    wecom: {
      ...channels.wecom,
      owner_permission_level: normalizeOwnerPermissionLevel(channels.wecom.owner_permission_level),
    },
  }
}

function listInstalledStyleIds(): string[] {
  const stylesDir = path.join(CONFIG_DIR, 'claude-config', 'output-styles')
  const ids = new Set<string>([DEFAULT_STYLE_ID, CORE_STYLE_ID])
  if (fs.existsSync(path.join(stylesDir, `${CORE_STYLE_ID}.md`))) {
    ids.add(CORE_STYLE_ID)
  }
  const extensionsDir = path.join(stylesDir, 'extensions')
  if (fs.existsSync(extensionsDir)) {
    for (const file of fs.readdirSync(extensionsDir).filter((f) => f.endsWith('.md'))) {
      ids.add(file.replace(/\.md$/, ''))
    }
  }
  return [...ids]
}

function loadSettingsFromRaw(raw: Record<string, unknown> | null): Settings {

  const merged = deepMerge(cloneDefaults(), raw ?? {}) as Settings

  merged.custom_auth_type = raw?.custom_auth_type === 'api_key' ? 'api_key' : 'auth_token'

  merged.context_limit_anthropic = normalizeContextLimit(raw?.context_limit_anthropic)
  merged.context_limit_glm = normalizeContextLimit(raw?.context_limit_glm)
  merged.context_limit_deepseek = normalizeContextLimit(raw?.context_limit_deepseek)
  merged.context_limit_custom = normalizeContextLimit(raw?.context_limit_custom)
  merged.context_limit = merged.active_provider === 'glm'
    ? merged.context_limit_glm
    : merged.active_provider === 'deepseek'
      ? merged.context_limit_deepseek
      : merged.active_provider === 'custom'
        ? merged.context_limit_custom
        : merged.context_limit_anthropic

  merged.max_chat_attachments = normalizeMaxChatAttachments(merged.max_chat_attachments)
  merged.paste_text_attachment_threshold = normalizePasteTextAttachmentThreshold(merged.paste_text_attachment_threshold)

  merged.download_directory = normalizeDownloadSubdirectory(
    merged.download_directory,
    path.resolve(expandHomePath(merged.user_directory || DEFAULT_USER_DIRECTORY)),
  )

  merged.channels = normalizeChannelsConfig(merged.channels)

  merged.user_directory_blacklist = normalizeUserDirectoryBlacklist(merged.user_directory_blacklist)
  merged.open_browser_allowed_origins = normalizeOpenBrowserAllowedOrigins(merged.open_browser_allowed_origins)
  merged.zcf_custom_roles = normalizeZcfCustomRoles(merged.zcf_custom_roles)
  merged.zcf_default_role = migrateLegacyDefaultRole(merged.zcf_default_role)
  merged.zcf_enabled_roles = normalizeZcfEnabledRoles(
    merged.zcf_enabled_roles,
    merged.zcf_custom_roles,
    listInstalledStyleIds(),
    merged.zcf_default_role,
  )
  merged.zcf_default_role = merged.zcf_enabled_roles[0] || CORE_STYLE_ID
  merged.zcf_default_mode = normalizeZcfMode(merged.zcf_default_mode)

  const plaintextSecrets = collectPlaintextSecretsFromRaw(raw)

  const encryptedBlob = raw?._encrypted as EncryptedSettingsBlob | undefined

  const decryptedSecrets = encryptedBlob?.fields && isSecretStoreReady()

    ? decryptSecrets(encryptedBlob.fields)

    : {}



  const secrets = { ...decryptedSecrets, ...plaintextSecrets }

  return applySecrets(merged, secrets)

}



function buildPersistedSettings(settings: Settings): Record<string, unknown> {

  const secrets = extractSecrets(settings)

  const publicSettings = clearSecretsOnDisk(settings) as unknown as Record<string, unknown>

  delete publicSettings._encrypted



  if (!isSecretStoreReady()) {

    const legacy = structuredClone(settings) as unknown as Record<string, unknown>

    delete legacy._encrypted

    return legacy

  }



  return {

    ...publicSettings,

    _encrypted: {

      v: 1,

      fields: encryptSecrets(secrets),

    },

  }

}



function persistSettingsToDisk(settings: Settings): void {

  fs.mkdirSync(CONFIG_DIR, { recursive: true })

  const payload = buildPersistedSettings(settings)

  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(payload, null, 2))

}



export async function initSettings(): Promise<void> {

  await initSecretStore()

  const raw = readRawSettingsFile()

  _settings = loadSettingsFromRaw(raw)

  _settingsInitialized = true

  if (raw && countInvalidBlacklistEntries(raw.user_directory_blacklist) > 0) {
    persistSettingsToDisk(_settings)
    log.info('Removed invalid user directory blacklist entries from settings')
  }



  if (raw && rawFileHasPlaintextSecrets(raw) && isSecretStoreReady()) {

    persistSettingsToDisk(_settings)

    log.info('Migrated plaintext settings secrets to SM4 encrypted storage')

  }

}



export function resetSettingsStateForTests(): void {

  _settings = null

  _settingsInitialized = false

}



export function getSettings(): Settings {

  if (_settings) return _settings

  _settings = loadSettingsFromRaw(readRawSettingsFile())

  return _settings

}



export function updateSettings(updates: Partial<Settings>): Settings {

  const current = getSettings()

  _settings = deepMerge(current, updates) as Settings

  _settings.max_chat_attachments = normalizeMaxChatAttachments(_settings.max_chat_attachments)
  _settings.context_limit = normalizeContextLimit(_settings.context_limit)
  _settings.context_limit_anthropic = normalizeContextLimit(_settings.context_limit_anthropic)
  _settings.context_limit_glm = normalizeContextLimit(_settings.context_limit_glm)
  _settings.context_limit_deepseek = normalizeContextLimit(_settings.context_limit_deepseek)
  _settings.context_limit_custom = normalizeContextLimit(_settings.context_limit_custom)
  _settings.paste_text_attachment_threshold = normalizePasteTextAttachmentThreshold(_settings.paste_text_attachment_threshold)
  _settings.welcome_featured_site_limit = normalizeWelcomeFeaturedSiteLimit(_settings.welcome_featured_site_limit)
  _settings.user_directory_blacklist = normalizeUserDirectoryBlacklist(_settings.user_directory_blacklist)
  _settings.open_browser_allowed_origins = normalizeOpenBrowserAllowedOrigins(_settings.open_browser_allowed_origins)
  _settings.zcf_custom_roles = normalizeZcfCustomRoles(_settings.zcf_custom_roles)
  if (updates.zcf_default_role !== undefined) {
    _settings.zcf_default_role = migrateLegacyDefaultRole(_settings.zcf_default_role)
  }
  _settings.zcf_enabled_roles = normalizeZcfEnabledRoles(
    _settings.zcf_enabled_roles,
    _settings.zcf_custom_roles,
    listInstalledStyleIds(),
    _settings.zcf_default_role,
  )
  _settings.zcf_default_role = _settings.zcf_enabled_roles[0] || CORE_STYLE_ID
  _settings.zcf_default_mode = normalizeZcfMode(_settings.zcf_default_mode)

  persistSettingsToDisk(_settings)

  _settingsInitialized = true

  return _settings

}



function deepMerge(base: unknown, override: unknown): unknown {

  if (typeof base !== 'object' || base === null) return override ?? base

  if (typeof override !== 'object' || override === null) return override ?? base

  // Arrays should be replaced, not merged

  if (Array.isArray(override)) return override

  const result = { ...(base as Record<string, unknown>) }

  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {

    if (k === '_encrypted') continue

    if (v !== undefined) {

      result[k] = v === null ? null : deepMerge(result[k], v)

    }

  }

  return result

}



/** Check if a site (adapter) is enabled. Missing keys use the provided default (true if not specified). */

export function getSiteEnabled(adapterId: string, defaultEnabled = true, managedEnabled?: boolean): boolean {
  if (managedEnabled !== undefined) return managedEnabled

  const s = getSettings()

  const toggle = s.site_toggles[adapterId]

  if (toggle !== undefined) {

    // User has explicitly set: 'hidden' counts as enabled, false is disabled

    return toggle !== false

  }

  // No user setting: use provided default (from registry)

  return defaultEnabled

}



/** Check if a site should be visible on the welcome page. Missing keys default to true. */

export function getSiteVisible(adapterId: string): boolean {

  const s = getSettings()

  const toggle = s.site_toggles[adapterId]

  // false = disabled (not visible), 'hidden' = enabled but not visible, true/undefined = visible

  return toggle !== false && toggle !== 'hidden'

}



/** Toggle a site's enabled state (enabled ↔ disabled). Preserves 'hidden' → false transition. Returns the new enabled value. */

export function toggleSite(adapterId: string): boolean {

  const s = getSettings()

  const current = s.site_toggles[adapterId]

  // If currently enabled (true, 'hidden', or undefined) → disable (false)

  // If currently disabled (false) → enable (true)

  const newState: boolean | 'hidden' = current === false ? true : false

  updateSettings({ site_toggles: { ...s.site_toggles, [adapterId]: newState } })

  return newState !== false

}



/** Set a site's visibility on the welcome page. Only works when site is enabled. */

export function setSiteVisibility(adapterId: string, visible: boolean, managedEnabled?: boolean): void {

  const s = getSettings()

  const current = s.site_toggles[adapterId]

  // Only change visibility if site is enabled (not false)

  if (!(managedEnabled ?? (current !== false))) return

  const newState: boolean | 'hidden' = visible ? true : 'hidden'

  updateSettings({ site_toggles: { ...s.site_toggles, [adapterId]: newState } })

}

/** Bulk set welcome-page visibility for all enabled adapters. */
export function setAllEnabledSitesWelcomeVisibility(
  adapterIds: string[],
  visible: boolean,
  managedStates = new Map<string, boolean>(),
): void {
  const s = getSettings()
  const toggles = { ...s.site_toggles }
  for (const id of adapterIds) {
    if (!(managedStates.get(id) ?? (toggles[id] !== false))) continue
    toggles[id] = visible ? true : 'hidden'
  }
  updateSettings({ site_toggles: toggles })
}


/** Get the set of currently enabled adapter IDs. */

export function getEnabledAdapterIds(): Set<string> {

  const s = getSettings()

  // All adapters are enabled by default; only explicitly disabled ones are excluded

  // We return a special marker: if site_toggles is empty, caller should treat all as enabled

  const disabled = Object.entries(s.site_toggles).filter(([, v]) => v === false).map(([k]) => k)

  // Return null-like signal via empty set only if everything is disabled (unlikely)

  // Caller should check: if adapterId is not in the set AND set is non-empty → disabled

  return new Set(

    Object.entries(s.site_toggles).filter(([, v]) => v !== false).map(([k]) => k)

  )

}



export function expandHomePath(input: string): string {

  if (!input) return DEFAULT_USER_DIRECTORY

  if (input === '~') return os.homedir()

  if (input.startsWith('~/') || input.startsWith('~\\')) {

    return path.join(os.homedir(), input.slice(2))

  }

  return input

}



export function normalizeMaxChatAttachments(value: unknown): number {

  const next = Number(value)

  if (!Number.isFinite(next)) return DEFAULT_MAX_CHAT_ATTACHMENTS

  return Math.min(MAX_CHAT_ATTACHMENTS, Math.max(MIN_CHAT_ATTACHMENTS, Math.floor(next)))

}

export function normalizePasteTextAttachmentThreshold(value: unknown): number {
  const next = Number(value)
  if (!Number.isFinite(next)) return DEFAULT_PASTE_TEXT_ATTACHMENT_THRESHOLD
  return Math.min(
    MAX_PASTE_TEXT_ATTACHMENT_THRESHOLD,
    Math.max(MIN_PASTE_TEXT_ATTACHMENT_THRESHOLD, Math.floor(next)),
  )
}

export function normalizeWelcomeFeaturedSiteLimit(value: unknown): number {
  const next = Number(value)
  if (!Number.isFinite(next)) return DEFAULT_WELCOME_FEATURED_SITE_LIMIT
  return Math.min(MAX_WELCOME_FEATURED_SITE_LIMIT, Math.max(MIN_WELCOME_FEATURED_SITE_LIMIT, Math.floor(next)))
}

export function normalizeOpenBrowserAllowedOrigin(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    url.search = ''
    url.pathname = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function normalizeOpenBrowserAllowedOrigins(value: unknown): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : String(value ?? '').split(',')
  const origins = new Set<string>()
  for (const item of rawItems) {
    const origin = normalizeOpenBrowserAllowedOrigin(item)
    if (origin) origins.add(origin)
  }
  return [...origins]
}

export function getUserDirectory(): string {

  const s = getSettings()

  return path.resolve(expandHomePath(s.user_directory || DEFAULT_USER_DIRECTORY))

}

export function getConfigDirectory(): string {
  return CONFIG_DIR
}

export function getDownloadSubdirectory(): string {

  const s = getSettings()

  return normalizeDownloadSubdirectory(s.download_directory, getUserDirectory())

}

export function getDownloadDirectory(): string {

  return resolveDownloadDirectory(getUserDirectory(), getSettings().download_directory)

}



export function ensureDownloadDirectory(): string {

  const dir = getDownloadDirectory()

  fs.mkdirSync(dir, { recursive: true })

  return dir

}



export function getMaxChatAttachments(): number {

  const s = getSettings()

  const next = normalizeMaxChatAttachments(s.max_chat_attachments)

  if (next !== s.max_chat_attachments) {

    updateSettings({ max_chat_attachments: next })

  }

  return next

}

export function getPasteTextAttachmentThreshold(): number {
  const s = getSettings()
  const next = normalizePasteTextAttachmentThreshold(s.paste_text_attachment_threshold)
  if (next !== s.paste_text_attachment_threshold) {
    updateSettings({ paste_text_attachment_threshold: next })
  }
  return next
}

export function getWelcomeFeaturedSiteLimit(): number {
  const s = getSettings()
  const next = normalizeWelcomeFeaturedSiteLimit(s.welcome_featured_site_limit)
  if (next !== s.welcome_featured_site_limit) {
    updateSettings({ welcome_featured_site_limit: next })
  }
  return next
}

export { DEFAULT_RESOURCE_PREVIEW_EXTENSIONS }

export function getResourcePreviewExtensions(): string[] {
  return getEffectivePreviewExtensions(getSettings().resource_preview_extensions)
}

export function getResourcePreviewExtensionSet(): Set<string> {
  return getPreviewExtensionSet(getSettings().resource_preview_extensions)
}

export function isResourcePreviewExtensionsCustomized(): boolean {
  return getSettings().resource_preview_extensions !== null
}

export function updateResourcePreviewExtensions(extensions: string[]): Settings {
  return updateSettings({ resource_preview_extensions: normalizePreviewExtensions(extensions) })
}

export function resetResourcePreviewExtensions(): Settings {
  return updateSettings({ resource_preview_extensions: null })
}

export function getUserDirectoryBlacklist(): UserDirectoryBlacklistEntry[] {

  return normalizeUserDirectoryBlacklist(getSettings().user_directory_blacklist)

}

export function getOpenBrowserAllowedOrigins(): string[] {
  return normalizeOpenBrowserAllowedOrigins(getSettings().open_browser_allowed_origins)
}



export function ensureUserDirectory(): string {

  const dir = getUserDirectory()

  fs.mkdirSync(dir, { recursive: true })

  return dir

}
