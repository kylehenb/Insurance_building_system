import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const { orderId } = await req.json()
    if (!orderId) {
      return NextResponse.json({ error: 'orderId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Step 2: Fetch insurer_order
    console.log('[lodge] fetching order', orderId)
    const { data: order, error: orderError } = await supabase
      .from('insurer_orders')
      .select('*')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      console.error('[lodge] order fetch error:', orderError)
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Step 3: Guard — not already lodged
    if (order.job_id) {
      return NextResponse.json({ error: 'Order already lodged' }, { status: 400 })
    }

    const tenantId = order.tenant_id

    // Step 4: Get tenant job_prefix
    console.log('[lodge] fetching tenant', tenantId)
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('job_prefix')
      .eq('id', tenantId)
      .single()

    if (tenantError || !tenant) {
      console.error('[lodge] tenant fetch error:', tenantError)
      return NextResponse.json({ error: 'Tenant not found' }, { status: 500 })
    }

    const prefix = tenant.job_prefix

    // Step 4 cont: Compute next job number
    console.log('[lodge] finding max job number for tenant', tenantId)
    const { data: existingJobs } = await supabase
      .from('jobs')
      .select('job_number')
      .eq('tenant_id', tenantId)

    let maxNum = 1000
    for (const j of existingJobs ?? []) {
      const match = j.job_number.match(/(\d+)$/)
      if (match) {
        const n = parseInt(match[1], 10)
        if (n > maxNum) maxNum = n
      }
    }
    const nextNum = maxNum + 1
    const jobNumber = `${prefix}${nextNum}`
    console.log('[lodge] new job number:', jobNumber)

    // Step 5: Create job
    console.log('[lodge] creating job')
    const { data: newJob, error: jobError } = await supabase
      .from('jobs')
      .insert({
        tenant_id: tenantId,
        job_number: jobNumber,
        claim_number: order.claim_number,
        insurer: order.insurer,
        adjuster: order.adjuster,
        property_address: order.property_address,
        insured_name: order.insured_name,
        insured_phone: order.insured_phone,
        insured_email: order.insured_email,
        additional_contacts: order.additional_contacts,
        date_of_loss: order.date_of_loss,
        loss_type: order.loss_type,
        claim_description: order.claim_description,
        special_instructions: order.special_instructions,
        sum_insured: order.sum_insured_building,
        excess: order.excess_building,
        status: 'active',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (jobError || !newJob) {
      console.error('[lodge] job create error:', jobError)
      return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
    }

    const jobId = newJob.id
    console.log('[lodge] job created:', jobId)

    // Step 6: Create inspection
    console.log('[lodge] creating inspection')
    const { data: newInspection, error: inspError } = await supabase
      .from('inspections')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        status: 'unscheduled',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (inspError || !newInspection) {
      console.error('[lodge] inspection create error:', inspError)
      return NextResponse.json({ error: 'Failed to create inspection' }, { status: 500 })
    }

    const inspectionId = newInspection.id
    console.log('[lodge] inspection created:', inspectionId)

    // Step 7: Create report
    console.log('[lodge] creating report')
    const reportType = order.wo_type ?? 'BAR'
    const { data: newReport, error: reportError } = await supabase
      .from('reports')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        inspection_id: inspectionId,
        report_type: reportType,
        report_ref: `${jobNumber}-R01`,
        version: 1,
        is_locked: false,
        status: 'draft',
        property_address: order.property_address,
        insured_name: order.insured_name,
        claim_number: order.claim_number,
        loss_type: order.loss_type,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (reportError || !newReport) {
      console.error('[lodge] report create error:', reportError)
      return NextResponse.json({ error: 'Failed to create report' }, { status: 500 })
    }

    const reportId = newReport.id
    console.log('[lodge] report created:', reportId)

    // Step 8: Create quote
    console.log('[lodge] creating quote')
    const { data: newQuote, error: quoteError } = await supabase
      .from('quotes')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        inspection_id: inspectionId,
        report_id: reportId,
        quote_ref: `${jobNumber}-Q01`,
        quote_type: 'inspection',
        version: 1,
        is_active_version: true,
        is_locked: false,
        status: 'draft',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (quoteError || !newQuote) {
      console.error('[lodge] quote create error:', quoteError)
      return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 })
    }

    console.log('[lodge] quote created:', newQuote.id)

    // Step 9: Update insurer_order
    console.log('[lodge] updating insurer_order')
    const { error: updateError } = await supabase
      .from('insurer_orders')
      .update({ job_id: jobId, status: 'lodged' })
      .eq('id', orderId)

    if (updateError) {
      console.error('[lodge] order update error:', updateError)
      return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
    }

    console.log('[lodge] done — jobNumber:', jobNumber, 'jobId:', jobId)
    return NextResponse.json({ jobNumber, jobId })

  } catch (err) {
    console.error('[lodge] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
