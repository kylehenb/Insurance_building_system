import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'
import type { Database } from '@/lib/supabase/database.types'

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
  const now = new Date()

  for (const job of jobs) {
    if (!job.job_number?.trim() || !job.property_address?.trim()) {
      errors.push({ job_number: job.job_number ?? '', error: 'Missing job number or address' })
      continue
    }

    const { data: newJob, error: jobError } = await supabase
      .from('jobs')
      .insert({
        tenant_id: tenantId,
        job_number: job.job_number.trim(),
        job_type: 'insurance',
        insurer: 'Midcity',
        property_address: job.property_address.trim(),
        created_at: now.toISOString(),
      } as Database['public']['Tables']['jobs']['Insert'])
      .select('id, job_number')
      .single()

    if (jobError || !newJob) {
      console.error('[midcity/bulk-jobs] create job error:', jobError)
      errors.push({ job_number: job.job_number, error: 'Failed to create job' })
      continue
    }

    const { data: newInspection, error: inspError } = await supabase
      .from('inspections')
      .insert({
        tenant_id: tenantId,
        job_id: newJob.id,
        status: 'appointment_confirmed',
        start_time: job.start_time?.trim() || null,
        created_at: now.toISOString(),
      } as Database['public']['Tables']['inspections']['Insert'])
      .select('id')
      .single()

    if (inspError || !newInspection) {
      console.error('[midcity/bulk-jobs] create inspection error:', inspError)
      errors.push({ job_number: job.job_number, error: 'Failed to create inspection' })
      continue
    }

    created.push({
      jobId: newJob.id,
      jobNumber: newJob.job_number ?? job.job_number,
      inspectionId: newInspection.id,
    })
  }

  return NextResponse.json({ created, errors })
}
