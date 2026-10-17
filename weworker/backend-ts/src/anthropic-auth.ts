export type AnthropicAuthType = 'auth_token' | 'api_key'

export function normalizeAnthropicAuthType(value: unknown): AnthropicAuthType {
  return value === 'api_key' ? 'api_key' : 'auth_token'
}

export function isAnthropicAuthType(value: unknown): value is AnthropicAuthType {
  return value === 'auth_token' || value === 'api_key'
}

export function usesAnthropicBearerToken(
  providerId: string | undefined,
  customAuthType?: AnthropicAuthType,
): boolean {
  return providerId === 'builtin' || (providerId === 'custom'
    && normalizeAnthropicAuthType(customAuthType) === 'auth_token')
}

export function buildAnthropicAuthHeaders(
  apiKey: string,
  providerId?: string,
  customAuthType?: AnthropicAuthType,
): Record<string, string> {
  return usesAnthropicBearerToken(providerId, customAuthType)
    ? { authorization: `Bearer ${apiKey}` }
    : { 'x-api-key': apiKey }
}
