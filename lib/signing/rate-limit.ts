import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

// Fixed-window rate limiting backed by Postgres (signing_rate_limit_hit),
// so it holds across serverless instances with no paid service.

export interface RateLimit {
  max: number
  windowSeconds: number
}

/**
 * Records a hit and returns true while within the limit. Fails open if the
 * database call itself errors, so a limiter outage never locks a signer out.
 */
export async function checkRateLimit(service: SupabaseClient<Database>, key: string, limit: RateLimit): Promise<boolean> {
  const { data, error } = await service.rpc('signing_rate_limit_hit', {
    p_key: key,
    p_max: limit.max,
    p_window_seconds: limit.windowSeconds,
  })
  if (error) {
    console.error(`[signing] rate limit check failed for ${key}:`, error)
    return true
  }
  return data === true
}

/** Housekeeping: drop rate-limit rows from windows long gone. */
export async function pruneRateLimits(service: SupabaseClient<Database>, olderThanHours = 24): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000).toISOString()
  const { error } = await service.from('signing_rate_limits').delete().lt('window_start', cutoff)
  if (error) console.error('[signing] rate limit prune failed:', error)
}
