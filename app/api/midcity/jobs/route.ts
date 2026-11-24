import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'
import { recordOperation } from '@/lib/activity/log'
import { FieldJobDetailsError, updateFieldJobDetails } from '@/lib/jobs/field-job-details'
import { createFieldAppJob, FieldJobCreateError } from '@/lib/jobs/field-job-create'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'

export async function POST(req: NextRequest) {
  try {
    const userSession = await getUser()
    if (!userSession?.tenant_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    const created = await createFieldAppJob(createServiceClient(), userSession.tenant_id, {
      reference: str(body.job_number),
      address: str(body.property_address),
      startTime: str(body.start_time),
    })
    return NextResponse.json({ jobId: created.jobId, jobNumber: created.jobNumber, inspectionId: created.inspectionId })
  } catch (err) {
    if (err instanceof FieldJobCreateError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[midcity/jobs] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// A job's builder/insurer reference and address, changed from the field app's header
export async function PATCH(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'jobs.edit')
  if (denied) return denied
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const { jobId, reference, address } = body
  if (typeof jobId !== 'string' || typeof reference !== 'string' || typeof address !== 'string') {
    return NextResponse.json({ error: 'jobId, reference and address are required' }, { status: 400 })
  }
  try {
    const saved = await updateFieldJobDetails(createServiceClient(), me.tenantId, jobId, { reference, address })
    await recordOperation({ tenantId: me.tenantId, userId: me.userId, action: 'jobs.edit', operation: 'job.details', payload: { jobId, ...saved } })
    return NextResponse.json({ ok: true, ...saved })
  } catch (err) {
    if (err instanceof FieldJobDetailsError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[midcity/jobs] update details error:', err)
    return NextResponse.json({ error: 'Could not save the job details' }, { status: 500 })
  }
}
