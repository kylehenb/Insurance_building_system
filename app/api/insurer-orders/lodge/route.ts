import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import { recomputeAndSaveStage } from '@/lib/jobs/recomputeStage'
import { addDelay, parseTimeConfig } from '@/lib/scheduling/business-hours'

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

    // Step 4a: Load automation_config for KPI calculations
    console.log('[lodge] loading automation_config for KPI calculations')
    const { data: configData, error: configError } = await supabase
      .from('automation_config')
      .select('key, value')
      .eq('tenant_id', tenantId)

    if (configError) {
      console.error('[lodge] automation_config load error:', configError)
      return NextResponse.json({ error: 'Failed to load automation config' }, { status: 500 })
    }

    const rawConfig: Record<string, string> = {}
    configData?.forEach(row => {
      rawConfig[row.key] = row.value
    })

    const timeConfig = parseTimeConfig(rawConfig)
    const orderedAt = new Date()

    // Calculate KPI due dates using addDelay
    const kpi_contact_due = addDelay(timeConfig, orderedAt, 2, 'hours')
    const kpi_booking_due = addDelay(timeConfig, orderedAt, 24, 'hours')
    const kpi_visit_due = addDelay(timeConfig, orderedAt, 2, 'business_days')
    const kpi_report_due = addDelay(timeConfig, orderedAt, 4, 'business_days')

    // Step 4b: Check for existing job with same claim number
    console.log('[lodge] checking for existing job with claim_number:', order.claim_number)
    if (!order.claim_number) {
      return NextResponse.json({ error: 'Claim number is required' }, { status: 400 })
    }
    const { data: existingJobByClaim, error: claimCheckError } = await supabase
      .from('jobs')
      .select('id, job_number, claim_number, property_address')
      .eq('tenant_id', tenantId)
      .eq('claim_number', order.claim_number)
      .single()

    if (claimCheckError && claimCheckError.code !== 'PGRST116') {
      console.error('[lodge] claim number check error:', claimCheckError)
      return NextResponse.json({ error: 'Failed to check for existing job' }, { status: 500 })
    }

    // If job with same claim number exists, attach order to it
    if (existingJobByClaim) {
      console.log('[lodge] found existing job with same claim_number:', existingJobByClaim.job_number)
      
      // Update insurer_order to link to existing job
      const { error: linkError } = await supabase
        .from('insurer_orders')
        .update({ job_id: existingJobByClaim.id, status: 'linked' })
        .eq('id', orderId)

      if (linkError) {
        console.error('[lodge] link error:', linkError)
        return NextResponse.json({ error: 'Failed to link to existing job' }, { status: 500 })
      }

      console.log('[lodge] order linked to existing job')
      await recomputeAndSaveStage(existingJobByClaim.id)
      return NextResponse.json({
        jobNumber: existingJobByClaim.job_number,
        jobId: existingJobByClaim.id,
        linkedToExisting: true,
        message: 'Order linked to existing job with same claim number'
      })
    }

    // Step 4b: Check for existing jobs with same address (different claim number)
    if (order.property_address) {
      console.log('[lodge] checking for existing jobs with same address')
      const { data: jobsByAddress, error: addressCheckError } = await supabase
        .from('jobs')
        .select('id, job_number, claim_number, property_address')
        .eq('tenant_id', tenantId)
        .eq('property_address', order.property_address)
        .neq('claim_number', order.claim_number)

      if (addressCheckError) {
        console.error('[lodge] address check error:', addressCheckError)
        return NextResponse.json({ error: 'Failed to check for address duplicates' }, { status: 500 })
      }

      if (jobsByAddress && jobsByAddress.length > 0) {
        console.log('[lodge] found existing jobs with same address:', jobsByAddress.length)
        const matchingJobs = jobsByAddress.map(j => ({
          jobNumber: j.job_number,
          claimNumber: j.claim_number
        }))
        return NextResponse.json({ 
          error: 'Address already exists in system',
          warning: true,
          matchingJobs,
          message: `Found ${jobsByAddress.length} existing job(s) with same property address but different claim number. Please review before proceeding.`
        }, { status: 409 })
      }
    }

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
        contacts: order.contacts,
        adjuster_reference: order.adjuster_reference,
        order_sender_name: order.order_sender_name,
        order_sender_email: order.order_sender_email,
        date_of_loss: order.date_of_loss,
        loss_type: order.loss_type,
        claim_description: order.claim_description,
        special_instructions: order.special_instructions,
        sum_insured: order.sum_insured_building,
        excess: order.excess_building,
        kpi_contact_due: kpi_contact_due.toISOString(),
        kpi_booking_due: kpi_booking_due.toISOString(),
        kpi_visit_due: kpi_visit_due.toISOString(),
        kpi_report_due: kpi_report_due.toISOString(),
        created_at: new Date().toISOString(),
      } as Database['public']['Tables']['jobs']['Insert'])
      .select('id')
      .single()

    if (jobError || !newJob) {
      console.error('[lodge] job create error:', jobError)
      return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
    }

    const jobId = newJob.id
    console.log('[lodge] job created:', jobId)

    // Step 6: Conditionally create inspection based on wo_type
    let inspectionId: string | null = null
    const wo_type = order.wo_type

    if (wo_type === 'BAR') {
      console.log('[lodge] creating inspection for wo_type:', wo_type)
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

      inspectionId = newInspection.id
      console.log('[lodge] inspection created:', inspectionId)
    } else {
      console.log('[lodge] skipping inspection creation for wo_type:', wo_type)
    }

    // Step 7: Conditionally create report based on wo_type
    let reportId: string | null = null

    if (wo_type === 'BAR' || wo_type === 'make_safe' || wo_type === 'roof_report' || wo_type === 'specialist') {
      console.log('[lodge] creating report for wo_type:', wo_type)
      const { data: newReport, error: reportError } = await supabase
        .from('reports')
        .insert({
          tenant_id: tenantId,
          job_id: jobId,
          inspection_id: wo_type === 'BAR' ? inspectionId : null,
          report_type: wo_type,
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

      reportId = newReport.id
      console.log('[lodge] report created:', reportId)
    } else {
      console.log('[lodge] skipping report creation for wo_type:', wo_type)
    }

    // Step 8: Conditionally create quote based on wo_type
    let quoteId: string | null = null

    if (wo_type === 'BAR' || wo_type === 'quote_only') {
      console.log('[lodge] creating quote for wo_type:', wo_type)
      const { data: newQuote, error: quoteError } = await supabase
        .from('quotes')
        .insert({
          tenant_id: tenantId,
          job_id: jobId,
          inspection_id: wo_type === 'BAR' ? inspectionId : null,
          report_id: wo_type === 'BAR' ? reportId : null,
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

      quoteId = newQuote.id
      console.log('[lodge] quote created:', quoteId)
    } else {
      console.log('[lodge] skipping quote creation for wo_type:', wo_type)
    }

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

    await recomputeAndSaveStage(jobId)
    console.log('[lodge] done — jobNumber:', jobNumber, 'jobId:', jobId)
    return NextResponse.json({ jobNumber, jobId })

  } catch (err) {
    console.error('[lodge] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
