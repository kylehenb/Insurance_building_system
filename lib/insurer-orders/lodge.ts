import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { recomputeAndSaveStage } from '@/lib/jobs/recomputeStage'
import type { SupabaseClient as RawClient } from '@supabase/supabase-js'
import { kpiDueDates, loadClientKpis, loadTimeConfig } from '@/lib/kpi/client-kpis'
import { createInvoiceForReport } from '@/lib/invoices/report-to-invoice'
import { notifyJobApproved } from '@/lib/email/notify-job-approved'
import { sendOrderAcknowledgement, type OrderAcknowledgementResult } from '@/lib/email/order-acknowledgement'
import { resolveInsurerClient } from '@/lib/clients/resolve-insurer'
import { normaliseLossType } from '@/lib/loss-types'
import { linkOrderThreadsToJob } from '@/lib/communications/thread-link'
import { recordOrderLodged } from './learning'
import { runOrderChecks } from './checks'
import { orderWorkTypes, unknownWorkTypes, workTypesPhrase } from './work-order-type'
import { createServicesForOrder } from '@/lib/jobs/services'

// Lodging an insurer order: creates the job (next job number, KPI due dates,
// client) and what each of its work types needs — a BAR the inspection,
// report, quote and invoice; quote only a quote; a make safe, roof report,
// leak detection or specialist report a requested service to arrange later
// (lib/jobs/services.ts) — links
// the order's email thread, notifies the office and replies to the order's
// sender acknowledging it (template 'order_acknowledgement') — or links the order to the
// job that already has its claim number. Used by the Lodge button
// (app/api/insurer-orders/lodge) and the voice connector. With
// skipAcknowledgement (the office has already replied by hand) everything
// happens the same except the acknowledgement, and a note on the job's Comms
// feed says it was skipped on purpose. What the order's checks found (no
// phone number, landline only… — lib/insurer-orders/checks.ts) is noted on the
// job too, and the acknowledgement isn't sent when the office has already
// replied to the sender.

// Mapping of report types to reference prefixes
const REPORT_TYPE_PREFIXES: Record<string, string> = {
  BAR: 'BAR',
  storm_wind: 'SW',
  make_safe: 'MS',
  roof: 'RR',
  roof_report: 'RR',
  specialist: 'SPR',
  LDR: 'LDR',
}

export interface LodgeResult {
  jobNumber: string
  jobId: string
  /** The claim number already had a job; the order was linked to it */
  linkedToExisting?: boolean
  message?: string
  /** The acknowledgement reply to the order's sender (new jobs only) */
  acknowledgement?: OrderAcknowledgementResult
  /** What the order asked for (insurer_orders.wo_types) */
  workTypes?: string[]
  /** Earlier jobs at the same address under other claims (new jobs only; never blocks the lodge) */
  sameAddressJobs?: { jobNumber: string; claimNumber: string | null }[]
}

/** "job IRC1037 (claim CHC123)" for each earlier job at the address */
export function describeSameAddressJobs(jobs: { jobNumber: string; claimNumber: string | null }[]): string {
  return jobs.map(j => `job ${j.jobNumber} (claim ${j.claimNumber ?? 'none'})`).join(', ')
}

export class LodgeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Extra response fields returned to the Lodge button */
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'LodgeError'
  }
}

export const ACKNOWLEDGEMENT_SKIPPED = 'Skipped on purpose when lodging'

/**
 * Lodges an order. tenantId, when given, must own the order — both the Lodge
 * button (the signed-in user's tenant) and the voice connector pass it.
 * userId is who lodged it, named on the skipped-acknowledgement note.
 */
export async function lodgeInsurerOrder(
  supabase: SupabaseClient<Database>,
  orderId: string,
  options: { tenantId?: string; userId?: string | null; skipAcknowledgement?: boolean } = {},
): Promise<LodgeResult> {
  // Step 2: Fetch insurer_order
  console.log('[lodge] fetching order', orderId)
  const { data: order, error: orderError } = await supabase
    .from('insurer_orders')
    .select('*')
    .eq('id', orderId)
    .single()

  if (orderError || !order) {
    console.error('[lodge] order fetch error:', orderError)
    throw new LodgeError('Order not found', 404)
  }

  if (options.tenantId && order.tenant_id !== options.tenantId) {
    throw new LodgeError('Order not found', 404)
  }

  // Step 3: Guard — not already lodged
  if (order.job_id) {
    throw new LodgeError('Order already lodged', 400)
  }

  // Step 3a: What it asks for must be known — it decides what's created and
  // what the acknowledgement says
  const types = orderWorkTypes(order)
  if (!types.length) throw new LodgeError('Tick what the order asks for (its work types) before lodging', 400)
  const unknown = unknownWorkTypes(types)
  if (unknown.length) throw new LodgeError(`Work type "${unknown.join('", "')}" isn't one the app knows — correct it before lodging`, 400)

  const tenantId = order.tenant_id

  // Step 4: Get tenant job_prefix + job_sequence
  console.log('[lodge] fetching tenant', tenantId)
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('job_prefix, job_sequence')
    .eq('id', tenantId)
    .single()

  if (tenantError || !tenant) {
    console.error('[lodge] tenant fetch error:', tenantError)
    throw new LodgeError('Tenant not found', 500)
  }

  const prefix = tenant.job_prefix

  // Step 4a: Business hours for the KPI due dates (worked out once the insurer is known)
  let timeConfig
  try {
    timeConfig = await loadTimeConfig(supabase as unknown as RawClient, tenantId)
  } catch (configError) {
    console.error('[lodge] automation_config load error:', configError)
    throw new LodgeError('Failed to load automation config', 500)
  }
  // The KPI clock starts when the insurer's order arrived, not when it's lodged
  const orderedAt = order.created_at ? new Date(order.created_at) : new Date()

  // Step 4b: Check for existing job with same claim number
  console.log('[lodge] checking for existing job with claim_number:', order.claim_number)
  if (!order.claim_number) {
    throw new LodgeError('Claim number is required', 400)
  }
  const { data: existingJobByClaim, error: claimCheckError } = await supabase
    .from('jobs')
    .select('id, job_number, claim_number, property_address')
    .eq('tenant_id', tenantId)
    .eq('claim_number', order.claim_number)
    .single()

  if (claimCheckError && claimCheckError.code !== 'PGRST116') {
    console.error('[lodge] claim number check error:', claimCheckError)
    throw new LodgeError('Failed to check for existing job', 500)
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
      throw new LodgeError('Failed to link to existing job', 500)
    }

    console.log('[lodge] order linked to existing job')
    // Anything new it asks for (a make safe on a job that had a BAR, say)
    await addRequestedServices(supabase, tenantId, existingJobByClaim.id, orderId, types)
    await linkOrderThreadsToJob(supabase, tenantId, orderId, existingJobByClaim.id)
    await recomputeAndSaveStage(existingJobByClaim.id)
    return {
      jobNumber: existingJobByClaim.job_number,
      jobId: existingJobByClaim.id,
      linkedToExisting: true,
      message: 'Order linked to existing job with same claim number',
      workTypes: types,
    }
  }

  // Step 4b: Other jobs at the same address. The claim number decides whether
  // it's the same job (above) — a new claim at an address we've worked at
  // before is still a new job, so this never stops the lodge. The jobs found
  // are noted on the new job and returned so the office can see the history.
  let sameAddressJobs: { jobNumber: string; claimNumber: string | null }[] = []
  if (order.property_address) {
    const { data: jobsByAddress, error: addressCheckError } = await supabase
      .from('jobs')
      .select('id, job_number, claim_number, property_address')
      .eq('tenant_id', tenantId)
      .eq('property_address', order.property_address)
      .neq('claim_number', order.claim_number)

    if (addressCheckError) {
      console.error('[lodge] address check error:', addressCheckError)
    } else {
      sameAddressJobs = (jobsByAddress ?? []).map(j => ({ jobNumber: j.job_number, claimNumber: j.claim_number }))
    }
  }

  // Step 4 cont: Compute next job number (mirrors /api/jobs sequence logic)
  const explicitSequence = (tenant as unknown as { job_sequence: number | null }).job_sequence
  let currentSequence: number
  if (explicitSequence != null && explicitSequence > 1) {
    currentSequence = explicitSequence
  } else {
    console.log('[lodge] finding max job number for tenant', tenantId)
    const { data: existingJobs } = await supabase
      .from('jobs')
      .select('job_number')
      .eq('tenant_id', tenantId)
      .like('job_number', `${prefix}%`)

    currentSequence = 1000
    for (const j of existingJobs ?? []) {
      const match = j.job_number.match(/(\d+)$/)
      if (match) {
        const n = parseInt(match[1], 10)
        if (n > currentSequence) currentSequence = n
      }
    }
  }
  const nextNum = currentSequence + 1
  const jobNumber = `${prefix}${nextNum}`
  console.log('[lodge] new job number:', jobNumber)

  // Step 4c: Resolve client_id — use the order's linked client, else match insurer/adjuster name
  let resolvedClientId: string | null = order.client_id ?? null
  let resolvedInsurer: string | null = order.insurer
  const namesToMatch = [order.insurer, order.adjuster].filter((n): n is string => Boolean(n))
  if (!resolvedClientId && namesToMatch.length > 0) {
    const { data: matchingClients } = await supabase
      .from('clients')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .in('name', namesToMatch)

    if (matchingClients && matchingClients.length > 0) {
      const insurerMatch = order.insurer ? matchingClients.find(c => c.name === order.insurer) : null
      resolvedClientId = insurerMatch?.id ?? matchingClients[0].id
    }
  }
  if (!resolvedClientId) {
    const client = await resolveInsurerClient(supabase, tenantId, {
      insurer: order.insurer,
      fromEmail: order.order_sender_email,
      fromName: order.order_sender_name,
      subject: order.raw_email_subject,
      body: order.raw_email_body,
    })
    if (client) {
      resolvedClientId = client.id
      resolvedInsurer = client.name
    }
  }
  console.log('[lodge] resolved client_id:', resolvedClientId)

  // KPI due dates from this insurer's own times (the Clients page; defaults if none)
  const kpiDue = kpiDueDates(timeConfig, orderedAt, await loadClientKpis(supabase as unknown as RawClient, tenantId, resolvedClientId))

  // Step 5: Create job
  console.log('[lodge] creating job')
  const { data: newJob, error: jobError } = await supabase
    .from('jobs')
    .insert({
      tenant_id: tenantId,
      job_number: jobNumber,
      claim_number: order.claim_number,
      insurer: resolvedInsurer,
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
      loss_type: normaliseLossType(order.loss_type),
      claim_description: order.claim_description,
      special_instructions: order.special_instructions,
      sum_insured: order.sum_insured_building,
      excess: order.excess_building,
      client_id: resolvedClientId,
      ...kpiDue,
      kpi_started_at: orderedAt.toISOString(),
      created_at: new Date().toISOString(),
    } as Database['public']['Tables']['jobs']['Insert'])
    .select('id')
    .single()

  if (jobError || !newJob) {
    console.error('[lodge] job create error:', jobError)
    throw new LodgeError('Failed to create job', 500)
  }

  const jobId = newJob.id
  console.log('[lodge] job created:', jobId)

  // Persist sequence so future creations don't need to scan
  await supabase
    .from('tenants')
    .update({ job_sequence: nextNum } as unknown as Database['public']['Tables']['tenants']['Update'])
    .eq('id', tenantId)

  // Step 6: What the order asks for. A BAR gets the inspection, its report,
  // invoice and quote; quote only a quote; a make safe, roof report, leak
  // detection or specialist report becomes a requested service on the job,
  // done in-house or by a trade later (lib/jobs/services.ts).
  let inspectionId: string | null = null
  let reportId: string | null = null
  let quoteId: string | null = null

  if (types.includes('BAR')) {
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
      throw new LodgeError('Failed to create inspection', 500)
    }
    inspectionId = newInspection.id

    const { data: newReport, error: reportError } = await supabase
      .from('reports')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        inspection_id: inspectionId,
        report_type: 'BAR',
        report_ref: `${REPORT_TYPE_PREFIXES.BAR}-${jobNumber}-1`,
        version: 1,
        is_locked: false,
        status: 'draft',
        property_address: order.property_address,
        insured_name: order.insured_name,
        claim_number: order.claim_number,
        loss_type: normaliseLossType(order.loss_type),
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (reportError || !newReport) {
      console.error('[lodge] report create error:', reportError)
      throw new LodgeError('Failed to create report', 500)
    }
    reportId = newReport.id

    // The BAR's invoice, so it's never missed (property details may be null yet: default pricing)
    const { data: jobWithProperty } = await supabase
      .from('jobs')
      .select('property_details')
      .eq('id', jobId)
      .single()
    const propertyDetails = jobWithProperty?.property_details as Record<string, unknown> | null
    const storeys = propertyDetails?.storeys as string | null
    const propertyType = storeys === '2' || storeys === 'double' ? 'double_storey' : storeys === '1' || storeys === 'single' ? 'single_storey' : null

    const invoiceResult = await createInvoiceForReport(supabase, {
      tenantId,
      jobId,
      reportId,
      inspectionId,
      reportType: 'BAR',
      propertyType,
      propertyAddress: order.property_address,
      claimNumber: order.claim_number,
      jobNumber,
    })
    if (!invoiceResult) console.warn('[lodge] failed to auto-create invoice for the BAR')
  }

  if (types.includes('BAR') || types.includes('quote_only')) {
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
      throw new LodgeError('Failed to create quote', 500)
    }

    quoteId = newQuote.id
  }

  // Step 8: Link the BAR inspection to its report and quote
  if (inspectionId && reportId && quoteId) {
    const { error: updateError } = await supabase
      .from('inspections')
      .update({ report_id: reportId, quote_id: quoteId })
      .eq('id', inspectionId)

    if (updateError) {
      console.error('[lodge] inspection update error:', updateError)
      throw new LodgeError('Failed to link inspection to report and quote', 500)
    }
  }

  // Step 8b: The other things asked for, to arrange later
  await addRequestedServices(supabase, tenantId, jobId, orderId, types)

  // Step 9: Update insurer_order
  console.log('[lodge] updating insurer_order')
  const { error: updateError } = await supabase
    .from('insurer_orders')
    .update({ job_id: jobId, status: 'lodged' })
    .eq('id', orderId)

  if (updateError) {
    console.error('[lodge] order update error:', updateError)
    throw new LodgeError('Failed to update order', 500)
  }

  // What the office corrected on the AI's parse is learned from (tech spec §24.4)
  await recordOrderLodged(supabase as unknown as SupabaseClient, order as unknown as Parameters<typeof recordOrderLodged>[1], options.userId ?? null)

  // Move the order email thread (and any replies) out of the unlinked inbox
  await linkOrderThreadsToJob(supabase, tenantId, orderId, jobId)

  await recomputeAndSaveStage(jobId)

  await notifyJobApproved({
    tenantId,
    jobId,
    jobNumber,
    propertyAddress: order.property_address,
    insuredName: order.insured_name,
    inspectionId,
  })

  const userId = options.userId ?? null
  let acknowledgement: OrderAcknowledgementResult
  const to = order.order_sender_email?.trim()
  if (options.skipAcknowledgement) {
    acknowledgement = { sent: false, skipped: ACKNOWLEDGEMENT_SKIPPED }
    await noteOnJob(supabase, {
      tenantId, jobId, userId, source: 'order_acknowledgement_skipped',
      content: `Order acknowledgement not emailed${to ? ` to ${to}` : ''}: skipped on purpose when the order was lodged.`,
    })
  } else {
    acknowledgement = await sendOrderAcknowledgement(supabase, { tenantId, orderId, jobId })
    if (!acknowledgement.sent) console.warn('[lodge] acknowledgement not sent:', acknowledgement.skipped)
    if (acknowledgement.alreadyReplied) {
      await noteOnJob(supabase, {
        tenantId, jobId, userId, source: 'order_acknowledgement_skipped',
        content: `Order acknowledgement not emailed: ${acknowledgement.skipped}.`,
      })
    }
  }

  const checks = runOrderChecks(order)
  if (checks.length) {
    const lines = checks.map(c => `${c.message}${c.acknowledgementLine && acknowledgement.sent ? ' The acknowledgement asked the sender about it.' : ''}`)
    await noteOnJob(supabase, { tenantId, jobId, userId, source: 'order_checks', content: lines.join('\n') })
  }

  if (sameAddressJobs.length) {
    await noteOnJob(supabase, {
      tenantId, jobId, userId, source: 'order_same_address',
      content: `Same address as ${describeSameAddressJobs(sameAddressJobs)}.`,
    })
  }

  console.log('[lodge] done — jobNumber:', jobNumber, 'jobId:', jobId)
  return { jobNumber, jobId, acknowledgement, workTypes: types, ...(sameAddressJobs.length ? { sameAddressJobs } : {}) }
}

/** The make safe / roof report / leak detection / specialist services an order asks for, on the job */
async function addRequestedServices(supabase: SupabaseClient<Database>, tenantId: string, jobId: string, orderId: string, types: string[]): Promise<void> {
  try {
    await createServicesForOrder(supabase, { tenantId, jobId, orderId, types })
  } catch (err) {
    console.error('[lodge] requested services create error:', err)
    throw new LodgeError('Failed to add the requested services', 500)
  }
}

/** "a make safe and a building assessment report" — what an order asked for */
export function describeLodgedWork(types: readonly string[] | undefined): string {
  return types?.length ? workTypesPhrase(types) : ''
}

// A note on the job's Comms feed (signed by whoever lodged it): why the
// sender wasn't sent an acknowledgement, or what the order's checks found.
// Never fails the lodge.
async function noteOnJob(
  supabase: SupabaseClient<Database>,
  params: { tenantId: string; jobId: string; userId: string | null; content: string; source: string },
): Promise<void> {
  try {
    let author: string | null = null
    if (params.userId) {
      const { data: user } = await supabase
        .from('users').select('name').eq('tenant_id', params.tenantId).eq('id', params.userId).maybeSingle()
      author = user?.name?.trim() || null
    }
    const { error } = await supabase.from('communications').insert({
      tenant_id: params.tenantId,
      job_id: params.jobId,
      type: 'note',
      content: params.content,
      contact_name: author ?? 'Note',
      source: params.source,
      created_by: params.userId,
    })
    if (error) throw error
  } catch (err) {
    console.error(`[lodge] couldn't add the ${params.source} note on job ${params.jobId}:`, err)
  }
}
