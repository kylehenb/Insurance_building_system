import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import type { SigningEventType } from './types'

// Append-only audit trail (signing_events). The table rejects updates and
// deletes at the database level.

export interface SigningEventInput {
  requestId: string
  tenantId: string
  event: SigningEventType
  ip?: string | null
  userAgent?: string | null
  actorId?: string | null
  metadata?: Record<string, unknown>
}

/** Records an event. Never throws: an audit write failure is logged, not fatal. */
export async function logSigningEvent(service: SupabaseClient<Database>, input: SigningEventInput): Promise<void> {
  const { error } = await service.from('signing_events').insert({
    request_id: input.requestId,
    tenant_id: input.tenantId,
    event: input.event,
    ip: input.ip ?? null,
    user_agent: input.userAgent ? input.userAgent.slice(0, 500) : null,
    actor_id: input.actorId ?? null,
    metadata: (input.metadata ?? {}) as Json,
  })
  if (error) console.error(`[signing] audit event ${input.event} for ${input.requestId} failed:`, error)
}
