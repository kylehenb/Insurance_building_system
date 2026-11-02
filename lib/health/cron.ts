import { NextResponse, type NextRequest } from 'next/server'
import { healthDb, clip, errorMessage } from './db'
import { logError } from './errors'

// Every scheduled job (vercel.json crons) is wrapped in withCronRun (tech
// spec §25): a cron_runs row is opened when it starts and closed with how it
// went, so the watcher can tell a job that's failing, slow, or has stopped
// running at all — none of which anyone would otherwise see, because a cron's
// response goes nowhere.
//
//   export const GET = withCronRun('/api/gmail/poll', run)
//
// How a run is judged, from what the handler returns:
//   thrown, or HTTP 4xx/5xx                       → failed
//   HTTP 207, a non-empty { errors: [...] }, or
//   { error } on a 2xx                            → partial
//   anything else                                 → ok
// Calls without the cron secret are passed straight through (they get the
// handler's 401) and aren't recorded.

export type CronStatus = 'ok' | 'partial' | 'failed'

function hasCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`
}

export function judgeRun(httpStatus: number, body: unknown): { status: CronStatus; error: string | null } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const err = typeof b.error === 'string' ? b.error : b.error ? errorMessage(b.error) : null
  const errors = Array.isArray(b.errors) ? b.errors : []
  if (httpStatus >= 400) return { status: 'failed', error: err ?? `HTTP ${httpStatus}` }
  if (httpStatus === 207 || errors.length) {
    return { status: 'partial', error: err ?? (errors.length ? clip(errors.map(e => errorMessage(e)).join('; '), 2000) : null) }
  }
  if (err) return { status: 'partial', error: err }
  return { status: 'ok', error: null }
}

async function openRun(route: string): Promise<string | null> {
  try {
    const db = healthDb()
    if (!db) return null
    const { data, error } = await db.from('cron_runs').insert({ route, status: 'running' }).select('id').single()
    if (error) throw error
    return (data as { id: string }).id
  } catch (err) {
    console.error(`[health] couldn't open cron run for ${route}:`, err)
    return null
  }
}

async function closeRun(id: string | null, route: string, fields: {
  started: number; status: CronStatus; httpStatus: number | null; summary: unknown; error: string | null
}): Promise<void> {
  if (!id) return
  try {
    const db = healthDb()
    if (!db) return
    let summary = fields.summary ?? null
    if (summary && JSON.stringify(summary).length > 4000) summary = { truncated: JSON.stringify(summary).slice(0, 4000) }
    const { error } = await db.from('cron_runs').update({
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - fields.started,
      status: fields.status,
      http_status: fields.httpStatus,
      summary,
      error: clip(fields.error, 2000),
    }).eq('id', id)
    if (error) throw error
  } catch (err) {
    console.error(`[health] couldn't close cron run for ${route}:`, err)
  }
}

export function withCronRun<R extends Response>(route: string, handler: (req: NextRequest) => Promise<R>): (req: NextRequest) => Promise<R | NextResponse> {
  return async (req: NextRequest): Promise<R | NextResponse> => {
    if (!hasCronSecret(req)) return handler(req)
    const started = Date.now()
    const id = await openRun(route)
    try {
      const res = await handler(req)
      let body: unknown = null
      try { body = await res.clone().json() } catch { /* not JSON */ }
      const { status, error } = judgeRun(res.status, body)
      await closeRun(id, route, { started, status, httpStatus: res.status, summary: body, error })
      return res
    } catch (err) {
      await closeRun(id, route, { started, status: 'failed', httpStatus: 500, summary: null, error: errorMessage(err) })
      await logError(`cron:${route}`, err)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}
