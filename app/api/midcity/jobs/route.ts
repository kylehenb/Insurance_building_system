import { NextRequest, NextResponse } from 'next/server'
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
      return NextResponse.json({ error: 'Job number and address are required' }, { status: 400 })
    }

    const { data: newJob, error: jobError } = await supabase
      .from('jobs')
      .insert({
        tenant_id: tenantId,
        job_number: job_number.trim(),
        job_type: 'insurance',
        insurer: 'Midcity',
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
