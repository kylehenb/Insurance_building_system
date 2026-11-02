import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { permissionGate } from '@/lib/permissions/http'
import { recordOperation } from '@/lib/activity/log'
import { CloseJobError, closeJobs, isCloseReason, reopenJob } from '@/lib/jobs/close'
import { mailDb } from '@/lib/mail/sync'

// POST /api/jobs/close { items: [{ jobId, reason }] } — close jobs by hand,
// each with its reason (complete / declined / cancelled / no_decision).
// POST /api/jobs/close { reopen: jobId } — take a hand close off.
// Permission jobs.change_stage (needs approval: queued as 'jobs.close' / 'jobs.reopen').

const ID = /^[0-9a-f-]{36}$/i
const MAX_ITEMS = 500

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await sessionUser()
  if (!user) return unauthorized()
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const db = mailDb()

  if (typeof body.reopen === 'string') {
    if (!ID.test(body.reopen)) return NextResponse.json({ error: 'Invalid job' }, { status: 400 })
    const gated = await permissionGate(user.tenantId, user.userId, 'jobs.change_stage', { operation: 'jobs.reopen', payload: { jobId: body.reopen } })
    if (gated) return gated
    try {
      const job = await reopenJob(db, user.tenantId, body.reopen)
      await recordOperation({ tenantId: user.tenantId, userId: user.userId, action: 'jobs.change_stage', operation: 'jobs.reopen', payload: { jobId: body.reopen } })
      return NextResponse.json({ reopened: job })
    } catch (err) {
      if (err instanceof CloseJobError) return NextResponse.json({ error: err.message }, { status: err.status })
      throw err
    }
  }

  const raw = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : []
  const items = raw
    .map(i => (i && typeof i === 'object' ? i as Record<string, unknown> : {}))
    .filter(i => typeof i.jobId === 'string' && ID.test(i.jobId) && isCloseReason(i.reason))
    .map(i => ({ jobId: i.jobId as string, reason: i.reason as 'complete' | 'declined' | 'cancelled' | 'no_decision' }))
  if (!items.length) return NextResponse.json({ error: 'Choose the jobs to close, each with a reason' }, { status: 400 })

  const gated = await permissionGate(user.tenantId, user.userId, 'jobs.change_stage', { operation: 'jobs.close', payload: { items } })
  if (gated) return gated
  try {
    const closed = await closeJobs(db, user.tenantId, items)
    await recordOperation({ tenantId: user.tenantId, userId: user.userId, action: 'jobs.change_stage', operation: 'jobs.close', payload: { items } })
    return NextResponse.json({ closed })
  } catch (err) {
    if (err instanceof CloseJobError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[jobs/close] failed:', err)
    return NextResponse.json({ error: 'Could not close the jobs' }, { status: 500 })
  }
}
