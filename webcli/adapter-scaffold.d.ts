import type { SiteMemoryRecord } from '../weworker/backend-ts/src/site-memory.js'

export interface AdapterScaffoldResult {
  packageFormat?: 2
  managedBaseline?: { profile: string; name: string; digest: string | null; source: string | null }
  siteKey: string
  adapterDir: string
  generatedDir?: string
  mode?: string
  generationStrategy?: string
  files: Record<string, string>
  toolNames: string[]
  primaryListApiUrl?: string
  secondaryApiUrl?: string
  actionApiUrls?: string[]
  manifestUpdated?: boolean
  indexCatalogUpdated?: boolean
  registryCatalogUpdated?: boolean
  supportFiles: string[]
  removedGeneratedFiles?: string[]
  indexSnippet?: string
}

export function writeScaffoldFromSiteMemory(
  memory: SiteMemoryRecord,
  options?: Record<string, unknown>
): AdapterScaffoldResult

export function writeAdapterPackageFromSiteMemory(
  memory: SiteMemoryRecord,
  options?: Record<string, unknown>
): AdapterScaffoldResult
