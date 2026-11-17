import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'
import { recordOperation } from '@/lib/activity/log'
import { mailDb } from '@/lib/mail/sync'
import { JobDetailsError, saveJobEdit, type JobEdit } from '@/lib/jobs/details'

// PATCH /api/jobs/[jobId]/details { details?, insured?, contacts? } — the job's
// Overview → Job Details panel's Save. Checked and saved by saveJobEdit
// (lib/jobs/details.ts), the same code as the voice tools update_job_details
// and update_job_contact. Permission jobs.edit (allowed or not — no approval).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined)

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }): Promise<NextResponse> {
  const { jobId } = await params
  if (!UUID_RE.test(jobId)) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const user = await sessionUser()
  if (!user) return unauthorized()
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const denied = await permissionDenied(user.tenantId, user.userId, 'jobs.edit')
  if (denied) return denied

  const edit: JobEdit = {
    details: obj(body.details),
    insured: obj(body.insured) as JobEdit['insured'],
    contacts: Array.isArray(body.contacts) ? body.contacts as JobEdit['contacts'] : undefined,
  }
  const db = mailDb()
  try {
    const result = await saveJobEdit(db, user.tenantId, jobId, edit)
    if (result.changed.length) {
      await recordOperation({ tenantId: user.tenantId, userId: user.userId, action: 'jobs.edit', operation: 'job.edit', payload: { jobId, edit, changed: result.changed }, service: db as never })
    }
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof JobDetailsError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[jobs/details] save failed:', err)
    return NextResponse.json({ error: 'Could not save the job details' }, { status: 500 })
  }
}
