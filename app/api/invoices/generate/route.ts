import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  generateAssessmentInvoice,
  generateExcessInvoice,
  generateBalanceInvoice,
  generateMakeSafeInvoice,
} from '@/lib/invoices/generators'
import { generateInvoiceRef } from '@/lib/invoices/ref'

const DEFAULT_GST_PCT = 0.1

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    type: string
    jobId: string
    tenantId: string
    reportId?: string
    excessAmountIncGst?: number
    workOrderId?: string
    lineItems?: Array<{ description: string; quantity: number; unitPrice: number; unit?: string; libraryItemId?: string }>
  }

  const { type, jobId, tenantId } = body

  if (!type || !jobId || !tenantId) {
    return NextResponse.json({ error: 'Missing required fields: type, jobId, tenantId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Fetch job details needed by all types
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('job_number, claim_number, insured_name, excess, tenant_id')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  let generated: ReturnType<typeof generateAssessmentInvoice>

  if (type === 'assessment') {
    const reportId = body.reportId
    if (!reportId) {
      return NextResponse.json({ error: 'reportId required for assessment invoice' }, { status: 400 })
    }

    const { data: rateConfig, error: rateError } = await supabase
      .from('rate_config')
      .select('standard_charge, gst_pct')
      .eq('tenant_id', tenantId)
      .eq('report_type', 'BAR')
      .maybeSingle()

    if (rateError) {
      return NextResponse.json({ error: rateError.message }, { status: 500 })
    }

    const standardCharge = rateConfig?.standard_charge ?? 0
    const gstPct = rateConfig?.gst_pct ?? DEFAULT_GST_PCT

    generated = generateAssessmentInvoice({
      tenantId,
      jobId,
      reportId,
      jobRef: job.job_number ?? '',
      claimNumber: job.claim_number,
      standardCharge,
      gstPct,
    })

  } else if (type === 'excess') {
    let excessAmountIncGst = body.excessAmountIncGst
    if (!excessAmountIncGst) {
      if (!job.excess) {
        return NextResponse.json({ error: 'No excess amount on job and none provided' }, { status: 400 })
      }
      excessAmountIncGst = job.excess
    }

    generated = generateExcessInvoice({
      tenantId,
      jobId,
      claimNumber: job.claim_number,
      insuredName: job.insured_name,
      excessAmountIncGst,
      gstPct: DEFAULT_GST_PCT,
    })

  } else if (type === 'balance') {
    // Fetch approved quote amount
    const { data: quote } = await supabase
      .from('quotes')
      .select('approved_amount, gst_pct')
      .eq('job_id', jobId)
      .eq('tenant_id', tenantId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const approvedQuoteAmountIncGst = quote?.approved_amount ?? 0
    const gstPct = quote?.gst_pct ?? DEFAULT_GST_PCT

    // Sum of all non-voided outbound invoices for this job
    const { data: priorInvoices } = await supabase
      .from('invoices')
      .select('amount_inc_gst')
      .eq('job_id', jobId)
      .eq('tenant_id', tenantId)
      .eq('direction', 'outbound')
      .neq('status', 'voided')

    const previouslyInvoicedAmountIncGst = (priorInvoices ?? []).reduce(
      (sum, inv) => sum + (inv.amount_inc_gst ?? 0),
      0
    )

    generated = generateBalanceInvoice({
      tenantId,
      jobId,
      claimNumber: job.claim_number,
      approvedQuoteAmountIncGst,
      previouslyInvoicedAmountIncGst,
      gstPct,
    })

  } else if (type === 'make_safe') {
    const workOrderId = body.workOrderId
    if (!workOrderId) {
      return NextResponse.json({ error: 'workOrderId required for make_safe invoice' }, { status: 400 })
    }
    if (!body.lineItems || body.lineItems.length === 0) {
      return NextResponse.json({ error: 'lineItems required for make_safe invoice' }, { status: 400 })
    }

    generated = generateMakeSafeInvoice({
      tenantId,
      jobId,
      workOrderId,
      claimNumber: job.claim_number,
      lineItems: body.lineItems,
      gstPct: DEFAULT_GST_PCT,
    })

  } else {
    return NextResponse.json({ error: `Unknown invoice type: ${type}` }, { status: 400 })
  }

  // Generate invoice ref
  const invoiceRef = await generateInvoiceRef(supabase, tenantId, jobId, job.job_number ?? jobId)

  // Write invoice to DB
  const { data: invoice, error: insertError } = await supabase
    .from('invoices')
    .insert({ ...generated.invoiceData, invoice_ref: invoiceRef })
    .select('*')
    .single()

  if (insertError || !invoice) {
    return NextResponse.json({ error: insertError?.message ?? 'Failed to create invoice' }, { status: 500 })
  }

  // Write line items
  if (generated.lineItems.length > 0) {
    const lineItemsToInsert = generated.lineItems.map(li => ({
      ...li,
      invoice_id: invoice.id,
    }))

    const { error: itemsError } = await supabase
      .from('invoice_line_items')
      .insert(lineItemsToInsert)

    if (itemsError) {
      await supabase.from('invoices').delete().eq('id', invoice.id)
      return NextResponse.json({ error: itemsError.message }, { status: 500 })
    }
  }

  const { data: lineItems } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', invoice.id)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  return NextResponse.json({ invoice, lineItems: lineItems ?? [] }, { status: 201 })
}
