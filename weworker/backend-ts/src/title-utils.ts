/**
 * Shared title generation utilities — used by both desktop chat (server.ts)
 * and channel integrations (weixin, qq).
 */
import type { Settings } from './config.js'
import { createLogger } from './logger.js'
import { resolveAnthropicEndpoint } from './llm-egress.js'
import { findProviderByWeWorkerBaseUrl } from './provider-registry.js'
import { buildAnthropicAuthHeaders } from './anthropic-auth.js'
import { loadPrompt, renderPrompt } from './prompt-loader.js'

const log = createLogger('title')
const TITLE_USER_PROMPT_SEPARATOR = '\n<!-- title-user-prompt -->\n'

/** Generate a concise title from the user's first message (text truncation). */
export function generateTitle(message: string): string {
  let text = message.trim()
  // Remove common polite prefixes
  text = text.replace(/^(请你?|帮我|麻烦|能不能|可以).{0,2}(?=[\u4e00-\u9fff])/u, '')
  // Truncate at a natural break (punctuation, newline) between 6–30 chars
  const breakMatch = text.match(/^(.{6,30}?)[，。！？\n,.\-;；]/)
  if (breakMatch) return breakMatch[1]
  // Otherwise just take first 30 chars
  return text.slice(0, 30) + (text.length > 30 ? '…' : '')
}

export function buildTitlePrompts(message: string): { system: string; user: string } {
  const template = loadPrompt('title')
  const templateSeparatorIndex = template.indexOf(TITLE_USER_PROMPT_SEPARATOR)
  if (templateSeparatorIndex < 0 || template.indexOf(TITLE_USER_PROMPT_SEPARATOR, templateSeparatorIndex + 1) >= 0) {
    throw new Error('Invalid title prompt sections')
  }
  const rendered = renderPrompt('title', { user_message: message.slice(0, 200) })
  const prompt = rendered.endsWith('\n') ? rendered.slice(0, -1) : rendered
  const separatorIndex = prompt.indexOf(TITLE_USER_PROMPT_SEPARATOR)
  return {
    system: prompt.slice(0, separatorIndex),
    user: prompt.slice(separatorIndex + TITLE_USER_PROMPT_SEPARATOR.length),
  }
}

/**
 * Call the configured LLM provider to generate a concise conversation title.
 * Returns null on failure (caller should keep the fallback title).
 */
export async function generateTitleWithLLM(message: string, settings: Settings): Promise<string | null> {
  if (!settings.api_key) return null
  try {
    const prompts = buildTitlePrompts(message)
    const endpoint = resolveAnthropicEndpoint(settings)
    const effectiveProviderId = settings.active_provider === 'custom'
      ? findProviderByWeWorkerBaseUrl(settings.base_url)?.id || settings.active_provider
      : settings.active_provider
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...buildAnthropicAuthHeaders(settings.api_key, effectiveProviderId, settings.active_auth_type ?? settings.custom_auth_type),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 30,
        system: prompts.system,
        messages: [{
          role: 'user',
          content: prompts.user,
        }],
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) return null
    const data = await response.json() as { content?: Array<{ type: string; text?: string }> }
    const text = data.content?.find(b => b.type === 'text')?.text?.trim()
    if (!text || text.length === 0) return null
    // Clean up: remove quotes, trailing punctuation
    return text.replace(/^["'"「『]|["'"」』]$/g, '').replace(/[。！？.,!?]$/, '').slice(0, 30)
  } catch (e) {
    log.warn(`LLM title generation failed: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}
