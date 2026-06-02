import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  generateExcessInvoice,
  generateBalanceInvoice,
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
    .select('job_number, claim_number, insured_name, excess, tenant_id, client_id, property_address')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  let generated: {
    invoiceData: any
    lineItems: any[]
  }

  // Report-based invoices use template system with client config pricing
  if (['assessment', 'make_safe', 'roof', 'leak_detection'].includes(type)) {
    const reportId = body.reportId
    if (!reportId) {
      return NextResponse.json({ error: 'reportId required for this invoice type' }, { status: 400 })
    }

    // Map invoice types to template codes
    const templateCodeMap: Record<string, string> = {
      assessment: 'bar',
      make_safe: 'make_safe',
      roof: 'single_storey_roof', // Will be adjusted based on property type
      leak_detection: 'leak_detection',
    }
    const templateCode = templateCodeMap[type]

    // Fetch template
    const { data: template, error: templateError } = await supabase
      .from('invoice_templates')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('template_code', templateCode)
      .eq('is_active', true)
      .single()

    if (templateError || !template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    // Fetch client pricing
    if (!job.client_id) {
      return NextResponse.json({ error: 'Job has no client assigned' }, { status: 400 })
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', job.client_id)
      .eq('tenant_id', tenantId)
      .single()

    if (clientError || !client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // Determine price based on template code
    let price = 0
    if (type === 'assessment') {
      price = (client as any).bar_amount || 0
    } else if (type === 'make_safe') {
      price = (client as any).make_safe_amount || 0
    } else if (type === 'roof') {
      // For roof reports, check property type to use correct pricing
      // Default to single_storey, will need property_type from job in future
      price = (client as any).single_storey_roof_report_amount || (client as any).double_storey_roof_report_amount || 0
    } else if (type === 'leak_detection') {
      price = (client as any).leak_detection_report_amount || 0
    }

    // Replace placeholders in description
    let description = template.description
    description = description.replace(/{property_address}/g, job.property_address || 'N/A')
    description = description.replace(/{claim_number}/g, job.claim_number || 'N/A')
    description = description.replace(/{job_number}/g, job.job_number || 'N/A')
    description = description.replace(/{insured_name}/g, job.insured_name || 'N/A')

    // For make_safe, apply builder's margin from client settings
    const makeSafeMarkupPct = type === 'make_safe'
      ? ((client as any).builders_margin_pct ?? 0) / 100
      : null

    const lineItemTotal = price
    const markup = makeSafeMarkupPct != null ? Math.round(lineItemTotal * makeSafeMarkupPct * 100) / 100 : 0
    const amountExGst = Math.round((lineItemTotal + markup) * 100) / 100
    const gst = Math.round(amountExGst * DEFAULT_GST_PCT * 100) / 100
    const amountIncGst = Math.round((amountExGst + gst) * 100) / 100

    generated = {
      invoiceData: {
        tenant_id: tenantId,
        job_id: jobId,
        report_id: reportId,
        invoice_type: type,
        direction: 'outbound',
        gst_treatment: 'exclusive',
        amount_ex_gst: amountExGst,
        gst,
        amount_inc_gst: amountIncGst,
        status: 'draft',
        ...(makeSafeMarkupPct != null ? { markup_pct: makeSafeMarkupPct } : {}),
      },
      lineItems: [{
        tenant_id: tenantId,
        description,
        quantity: 1,
        unit_price: lineItemTotal,
        line_total: lineItemTotal,
        sort_order: 0,
      }],
    }

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
      .select('id, approved_amount, gst_pct, markup_pct')
      .eq('job_id', jobId)
      .eq('tenant_id', tenantId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let approvedQuoteAmountIncGst = quote?.approved_amount ?? 0
    const gstPct = quote?.gst_pct ?? DEFAULT_GST_PCT

    // For quotes approved before approved_amount was auto-set, compute from scope items
    if (!approvedQuoteAmountIncGst && quote?.id) {
      const { data: scopeItems } = await supabase
        .from('scope_items')
        .select('line_total')
        .eq('quote_id', quote.id)
        .eq('tenant_id', tenantId)
      const subtotal = (scopeItems ?? []).reduce((sum, item) => sum + (item.line_total ?? 0), 0)
      const markupPct = quote.markup_pct ?? 0
      approvedQuoteAmountIncGst = Math.round(subtotal * (1 + markupPct) * (1 + gstPct) * 100) / 100
    }

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
