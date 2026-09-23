export interface DesktopAdapter {
  id: string
  name: string
  description?: string
  display?: string
  match?: string[]
  homepage_url?: string
  requires_auth?: boolean
  auth_check_tool?: string
  hidden?: boolean
  icon?: string
  test_prompts?: string[]
  scenarios?: unknown[]
  route_templates?: unknown[]
  prompt_var_display?: Record<string, { label?: string; style?: 'code' | 'placeholder'; resolve?: string }>
  i18n?: { zh?: { name?: string; description?: string } }
  commands: Array<{ name: string; id: string; aliases?: string[]; runtime: string; execution?: { type: 'api'; runtime: 'background' }; safety: string; description: string; schema: Record<string, unknown> }>
  managed: { enabled: boolean; profile: string; source: string | null; digest: string | null; version: string | null; canEnable: boolean; diagnostics: string[] }
}
export function describeDesktopAdapters(options?: object): { adapters: DesktopAdapter[]; managedNames: Set<string>; revision: number }
export function toggleDesktopAdapter(name: string, options?: object): boolean | null
export function resolveDesktopUserAdaptersDir(): string
export function refreshDesktopAdapterSkills(target: string): { installed: number; retired: number; preserved: string[] }
export function isManagedAdapterSkillCurrent(content: string, directoryName?: string): boolean
export function createManagedAdapterSkillValidator(): (content: string, directoryName?: string) => boolean
