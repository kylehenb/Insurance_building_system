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
    const {
      job_type = 'insurance',
      insured_name,
      insured_phone,
      insured_email,
      property_address,
      insurer,
      invoice_to,
      claim_number,
      adjuster,
      adjuster_reference,
      loss_type,
      date_of_loss,
      claim_description,
      special_instructions,
      notes,
      sum_insured,
      excess,
    } = body

    // Fetch tenant prefix
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('job_prefix')
      .eq('id', tenantId)
      .single()

    if (tenantError || !tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 500 })
    }

    // Compute next job number — only consider jobs that carry the IRC prefix
    // (Midcity jobs are stored with raw external numbers and must not skew the sequence)
    const { data: existingJobs } = await supabase
      .from('jobs')
      .select('job_number')
      .eq('tenant_id', tenantId)
      .like('job_number', `${tenant.job_prefix}%`)

    let maxNum = 1000
    for (const j of existingJobs ?? []) {
      const match = j.job_number.match(/(\d+)$/)
      if (match) {
        const n = parseInt(match[1], 10)
        if (n > maxNum) maxNum = n
      }
    }
    const jobNumber = `${tenant.job_prefix}${maxNum + 1}`

    const { data: newJob, error: jobError } = await supabase
      .from('jobs')
      .insert({
        tenant_id: tenantId,
        job_number: jobNumber,
        job_type,
        insured_name: insured_name || null,
        insured_phone: insured_phone || null,
        insured_email: insured_email || null,
        property_address: property_address || null,
        insurer: insurer || null,
        invoice_to: invoice_to || null,
        claim_number: claim_number || null,
        adjuster: adjuster || null,
        adjuster_reference: adjuster_reference || null,
        loss_type: loss_type || null,
        date_of_loss: date_of_loss || null,
        claim_description: claim_description || null,
        special_instructions: special_instructions || null,
        notes: notes || null,
        sum_insured: sum_insured ? parseFloat(sum_insured) : null,
        excess: excess ? parseFloat(excess) : null,
        created_at: new Date().toISOString(),
      } as Database['public']['Tables']['jobs']['Insert'])
      .select('id, job_number')
      .single()

    if (jobError || !newJob) {
      console.error('[jobs] create error:', jobError)
      return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
    }

    return NextResponse.json({ id: newJob.id, job_number: newJob.job_number })
  } catch (err) {
    console.error('[jobs] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
