import { createHash, timingSafeEqual } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import type { McpContext } from '@/lib/mcp/server'

// The voice connector is added in claude.ai as a URL with a secret in the
// path (/api/mcp/<MCP_CONNECTOR_SECRET>) — claude.ai connectors take either
// OAuth or no auth, and a single-user app doesn't need OAuth yet. Whoever has
// the URL can act as MCP_USER_ID, so treat it like a password: rotate it by
// changing the env var and re-adding the connector.

/** Shorter secrets are refused so a placeholder can't switch the connector on. */
const MIN_SECRET_LENGTH = 32

function secretMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * The connector's context for a request, or null when the secret is wrong or
 * the connector isn't configured (the route answers 404 either way).
 */
export async function mcpContextFor(secret: string): Promise<McpContext | null> {
  const expected = process.env.MCP_CONNECTOR_SECRET ?? ''
  const userId = process.env.MCP_USER_ID ?? ''
  if (expected.length < MIN_SECRET_LENGTH || !userId) return null
  if (!secretMatches(secret, expected)) return null

  const supabase = createServiceClient()
  const { data: user, error } = await supabase
    .from('users').select('tenant_id').eq('id', userId).maybeSingle()
  if (error || !user?.tenant_id) {
    console.error('[mcp] MCP_USER_ID does not resolve to a user with a tenant', error)
    return null
  }
  return { supabase, tenantId: user.tenant_id, userId }
}
