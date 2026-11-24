import { NextRequest, NextResponse } from 'next/server'
import { createFieldAppJob, FieldJobCreateError } from '@/lib/jobs/field-job-create'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'

export const dynamic = 'force-dynamic'

type JobInput = {
  job_number: string
  property_address: string
  start_time?: string
}

export async function POST(req: NextRequest) {
  const userSession = await getUser()
  if (!userSession?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = userSession.tenant_id
  const supabase = createServiceClient()

  let body: { jobs: JobInput[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { jobs } = body
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return NextResponse.json({ error: 'No jobs provided' }, { status: 400 })
  }

  const created: Array<{ jobId: string; jobNumber: string; inspectionId: string }> = []
  const errors: Array<{ job_number: string; error: string }> = []

  for (const job of jobs) {
    try {
      const made = await createFieldAppJob(supabase, tenantId, {
        reference: job.job_number ?? '',
        address: job.property_address ?? '',
        startTime: job.start_time,
      })
      created.push({ jobId: made.jobId, jobNumber: made.jobNumber, inspectionId: made.inspectionId })
    } catch (err) {
      if (!(err instanceof FieldJobCreateError)) console.error('[midcity/bulk-jobs] create job error:', err)
      errors.push({ job_number: job.job_number ?? '', error: err instanceof FieldJobCreateError ? err.message : 'Failed to create job' })
    }
  }

  return NextResponse.json({ created, errors })
}
