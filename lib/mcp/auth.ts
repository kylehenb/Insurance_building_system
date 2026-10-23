import { createHash, timingSafeEqual } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import type { McpContext } from '@/lib/mcp/server'
import { VOICE_KEY_PREFIX, findVoiceKey } from '@/lib/voice-keys/keys'

// The voice connector is added in claude.ai with "No sign-in" and a request
// header carrying a key: Authorization: Bearer <key>. A header (unlike a
// secret in the URL) stays out of request logs.
//
// Personal keys (irc_vk_…, Settings → Voice connector) act as the person who
// made them, with their permissions; revoking one stops it at once. The older
// shared key, MCP_CONNECTOR_SECRET acting as MCP_USER_ID, still works until
// those env vars are removed.

/** Shorter secrets are refused so a placeholder can't switch the connector on. */
const MIN_SECRET_LENGTH = 32

function secretMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** The key from "Authorization: Bearer <key>" — also "Bearer<key>", "Bearer: <key>" or a bare "<key>". */
export function keyFromAuthorization(header: string | null): string {
  return (header ?? '').trim().replace(/^Bearer[\s:]*/i, '').trim()
}

/**
 * The connector's context for a request, or null when the key is wrong or
 * the connector isn't configured (the route answers 401 either way). The
 * reason is logged, never the key.
 */
export async function mcpContextFor(authorization: string | null): Promise<McpContext | null> {
  const key = keyFromAuthorization(authorization)
  if (!key) {
    console.warn('[mcp] request without an Authorization header')
    return null
  }
  const supabase = createServiceClient()

  if (key.startsWith(VOICE_KEY_PREFIX)) {
    const found = await findVoiceKey(key, supabase)
    if (!found) {
      console.warn('[mcp] unknown or revoked personal key')
      return null
    }
    return { supabase, tenantId: found.tenantId, userId: found.userId, voiceKeyId: found.id }
  }

  // The shared key. Trimmed: a value pasted into Vercel can pick up a trailing newline
  const expected = (process.env.MCP_CONNECTOR_SECRET ?? '').trim()
  const userId = (process.env.MCP_USER_ID ?? '').trim()
  if (expected.length < MIN_SECRET_LENGTH || !userId) {
    console.warn('[mcp] not a personal key, and no shared key is configured (MCP_CONNECTOR_SECRET 32+ chars and MCP_USER_ID)')
    return null
  }
  if (!secretMatches(key, expected)) {
    console.warn(`[mcp] wrong key (got ${key.length} chars, expected ${expected.length})`)
    return null
  }

  const { data: user, error } = await supabase
    .from('users').select('tenant_id').eq('id', userId).maybeSingle()
  if (error || !user?.tenant_id) {
    console.error('[mcp] MCP_USER_ID does not resolve to a user with a tenant', error)
    return null
  }
  return { supabase, tenantId: user.tenant_id, userId }
}
