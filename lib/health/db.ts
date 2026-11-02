import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// The health tables (ai_calls, cron_runs, system_errors, health_alerts — tech
// spec §25) are written by the server only. Recording never fails the thing
// it records, so with no database configured (tests, local scripts) this
// returns null and the recorders skip quietly.

let override: SupabaseClient | null | undefined

export function healthDb(): SupabaseClient | null {
  if (override !== undefined) return override
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

/** Tests: point the recorders at a fake database (null turns recording off). Pass undefined to reset. */
export function setHealthDbForTests(db: SupabaseClient | null | undefined): void {
  override = db
}

export const clip = (s: string | null | undefined, n: number): string | null =>
  s ? (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s) : null

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}
