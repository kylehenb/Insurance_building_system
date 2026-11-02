import { healthDb, clip, errorMessage } from './db'

// Failures the app notices but carries on past — an AI reply it couldn't
// read, a fallback taken because something was down — go to system_errors as
// well as the console (tech spec §25), because Vercel's logs are gone in a
// few days and nobody reads them. The health watcher alerts on spikes and the
// weekly check counts them by source. Logging never throws.
//
// Use it where a failure would otherwise be silent. Errors that already fail
// the request (a 500 the user sees) don't need it.

export interface ErrorContext {
  tenantId?: string | null
  jobId?: string | null
  /** Anything that helps work out what happened (kept small) */
  detail?: Record<string, unknown>
}

export async function logError(source: string, err: unknown, ctx: ErrorContext = {}): Promise<void> {
  const message = errorMessage(err)
  console.error(`[${source}]`, message, ctx.detail ?? '')
  try {
    const db = healthDb()
    if (!db) return
    let detail = ctx.detail ?? null
    if (detail && JSON.stringify(detail).length > 4000) detail = { truncated: JSON.stringify(detail).slice(0, 4000) }
    const { error } = await db.from('system_errors').insert({
      tenant_id: ctx.tenantId ?? null,
      job_id: ctx.jobId ?? null,
      source,
      message: clip(message, 2000) ?? 'Unknown error',
      detail,
    })
    if (error) throw error
  } catch (e) {
    console.error(`[health] couldn't record error from ${source}:`, e)
  }
}
