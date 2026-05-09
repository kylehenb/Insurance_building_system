import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('jobId')
  const tenantId = searchParams.get('tenantId')

  if (!jobId || !tenantId) {
    return NextResponse.json({ error: 'Missing jobId or tenantId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('job_id', jobId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const invoicesWithMeta = await Promise.all(
    (invoices ?? []).map(async (invoice) => {
      const { data: items } = await supabase
        .from('invoice_line_items')
        .select('*')
        .eq('invoice_id', invoice.id)
        .eq('tenant_id', tenantId)
        .order('sort_order', { ascending: true })

      return {
        ...invoice,
        line_items: items ?? [],
        item_count: items?.length ?? 0,
      }
    })
  )

  return NextResponse.json(invoicesWithMeta)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { jobId, tenantId, invoiceType, direction = 'outbound', lineItems, templateCode } = body as {
    jobId: string
    tenantId: string
    invoiceType: string
    direction?: string
    lineItems?: Array<{ description: string; quantity: number; unit_price: number }>
    templateCode?: string // e.g., 'bar', 'single_storey_roof', etc.
  }

  if (!jobId || !tenantId || !invoiceType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('job_number, excess, client_id, property_address, claim_number, insured_name')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // If templateCode is provided, fetch template and client pricing to build line items
  let processedLineItems = lineItems
  if (templateCode && !lineItems) {
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
    switch (templateCode) {
      case 'bar':
        price = (client as any).bar_amount || 0
        break
      case 'single_storey_roof':
        price = (client as any).single_storey_roof_report_amount || 0
        break
      case 'double_storey_roof':
        price = (client as any).double_storey_roof_report_amount || 0
        break
      case 'leak_detection':
        price = (client as any).leak_detection_report_amount || 0
        break
      case 'make_safe':
        price = (client as any).make_safe_amount || 0
        break
    }

    // Replace placeholders in description
    let description = template.description
    description = description.replace(/{property_address}/g, job.property_address || 'N/A')
    description = description.replace(/{claim_number}/g, job.claim_number || 'N/A')
    description = description.replace(/{job_number}/g, job.job_number || 'N/A')
    description = description.replace(/{insured_name}/g, job.insured_name || 'N/A')

    // Build line item from template
    processedLineItems = [{
      description,
      quantity: 1,
      unit_price: price,
    }]
  }

  const { count } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('tenant_id', tenantId)

  const seq = String((count ?? 0) + 1).padStart(3, '0')
  const invoiceRef = `INV-${job.job_number}-${seq}`

  // Calculate totals from line items
  let amountExGst = 0
  if (processedLineItems && processedLineItems.length > 0) {
    amountExGst = processedLineItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0)
  }

  // For excess invoices, the excess amount is GST-inclusive - calculate ex-GST and GST components
  let gst = 0
  let amountIncGst = 0
  if (invoiceType === 'excess') {
    // Excess is entered as GST-inclusive amount
    // Calculate ex-GST: amountIncGst / 1.10
    amountIncGst = amountExGst
    amountExGst = amountIncGst / 1.10
    gst = amountIncGst - amountExGst
  } else {
    // Other invoices add GST
    gst = amountExGst * 0.10
    amountIncGst = amountExGst + gst
  }

  const { data: invoice, error } = await supabase
    .from('invoices')
    .insert({
      tenant_id: tenantId,
      job_id: jobId,
      invoice_ref: invoiceRef,
      invoice_type: invoiceType,
      direction,
      amount_ex_gst: amountExGst,
      gst,
      amount_inc_gst: amountIncGst,
      status: 'draft',
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Insert line items if provided
  if (processedLineItems && processedLineItems.length > 0) {
    const lineItemsToInsert = processedLineItems.map((item, index) => ({
      tenant_id: tenantId,
      invoice_id: invoice.id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: item.quantity * item.unit_price,
      sort_order: index,
    }))

    const { error: itemsError } = await supabase
      .from('invoice_line_items')
      .insert(lineItemsToInsert)

    if (itemsError) {
      // Rollback invoice if line items fail
      await supabase.from('invoices').delete().eq('id', invoice.id)
      return NextResponse.json({ error: itemsError.message }, { status: 500 })
    }
  }

  // Fetch line items for the created invoice to return consistent structure
  const { data: items } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', invoice.id)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  return NextResponse.json({
    ...invoice,
    line_items: items ?? [],
    item_count: items?.length ?? 0,
  }, { status: 201 })
}
