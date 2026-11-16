import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'
import { recordOperation } from '@/lib/activity/log'
import { FieldJobDetailsError, updateFieldJobDetails } from '@/lib/jobs/field-job-details'
import { FIELD_APP_INSURER } from '@/lib/jobs/field-app'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'
import type { Database } from '@/lib/supabase/database.types'

export async function POST(req: NextRequest) {
  try {
    const userSession = await getUser()
    if (!userSession?.tenant_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const tenantId = userSession.tenant_id
    const supabase = createServiceClient()

    const body = await req.json()
    const { job_number, property_address, start_time } = body

    if (!job_number?.trim() || !property_address?.trim()) {
      return NextResponse.json({ error: 'Builder/insurer reference and address are required' }, { status: 400 })
    }

    const { data: newJob, error: jobError } = await supabase
      .from('jobs')
      .insert({
        tenant_id: tenantId,
        job_number: job_number.trim(),
        job_type: 'insurance',
        insurer: FIELD_APP_INSURER,
        property_address: property_address.trim(),
        created_at: new Date().toISOString(),
      } as Database['public']['Tables']['jobs']['Insert'])
      .select('id, job_number')
      .single()

    if (jobError || !newJob) {
      console.error('[midcity/jobs] create job error:', jobError)
      return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
    }

    const { data: newInspection, error: inspError } = await supabase
      .from('inspections')
      .insert({
        tenant_id: tenantId,
        job_id: newJob.id,
        status: 'appointment_confirmed',
        start_time: start_time?.trim() || null,
        created_at: new Date().toISOString(),
      } as Database['public']['Tables']['inspections']['Insert'])
      .select('id')
      .single()

    if (inspError || !newInspection) {
      console.error('[midcity/jobs] create inspection error:', inspError)
      return NextResponse.json({ error: 'Failed to create inspection' }, { status: 500 })
    }

    return NextResponse.json({
      jobId: newJob.id,
      jobNumber: newJob.job_number,
      inspectionId: newInspection.id,
    })
  } catch (err) {
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
