import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Maps report types to invoice types
 */
export function mapReportTypeToInvoiceType(reportType: string): string {
  const mapping: Record<string, string> = {
    BAR: 'assessment',
    storm_wind: 'assessment',
    make_safe: 'make_safe',
    roof: 'roof',
    roof_report: 'roof',
    specialist: 'specialist_passthrough',
    LDR: 'leak_detection',
  }
  
  return mapping[reportType] || 'assessment'
}

/**
 * Determines the correct invoice template code based on report type and property details
 * For roof reports, this checks property_type to select single vs double storey pricing
 */
export function getInvoiceTemplateCode(
  reportType: string,
  propertyType?: string | null
): string {
  const baseMapping: Record<string, string> = {
    BAR: 'bar',
    storm_wind: 'bar',
    make_safe: 'make_safe',
    roof: 'single_storey_roof', // default, will be adjusted below
    roof_report: 'single_storey_roof',
    specialist: 'specialist',
    LDR: 'leak_detection',
  }

  let templateCode = baseMapping[reportType] || 'bar'

  // For roof reports, adjust based on property type
  if (reportType === 'roof' || reportType === 'roof_report') {
    if (propertyType === 'double_storey') {
      templateCode = 'double_storey_roof'
    } else if (propertyType === 'commercial') {
      // Commercial properties use double storey pricing as default
      templateCode = 'double_storey_roof'
    }
    // Default: single_storey_roof (already set)
  }

  return templateCode
}

/**
 * Fetches the appropriate price for a report type based on client configuration
 * For roof reports, this considers property_type to select correct pricing
 */
export async function getReportInvoicePrice(
  supabase: SupabaseClient,
  tenantId: string,
  clientId: string,
  reportType: string,
  propertyType?: string | null
): Promise<number> {
  const { data: client, error } = await supabase
    .from('clients')
    .select('bar_amount, single_storey_roof_report_amount, double_storey_roof_report_amount, make_safe_amount, leak_detection_report_amount')
    .eq('id', clientId)
    .eq('tenant_id', tenantId)
    .single()

  if (error || !client) {
    console.error('[getReportInvoicePrice] Failed to fetch client pricing:', error)
    return 0
  }

  // Determine price based on report type and property details
  let price = 0

  switch (reportType) {
    case 'BAR':
    case 'storm_wind':
      price = client.bar_amount || 0
      break
    case 'make_safe':
      price = client.make_safe_amount || 0
      break
    case 'roof':
    case 'roof_report':
      // For roof reports, check property type
      if (propertyType === 'double_storey' || propertyType === 'commercial') {
        price = client.double_storey_roof_report_amount || client.single_storey_roof_report_amount || 0
      } else {
        // Default to single storey (most common)
        price = client.single_storey_roof_report_amount || client.double_storey_roof_report_amount || 0
      }
      break
    case 'LDR':
      price = client.leak_detection_report_amount || 0
      break
    case 'specialist':
      // Specialist reports don't have a standard pricing field in clients
      // This would need to be configured per specialist type or use a default
      price = 0
      break
    default:
      price = 0
  }

  return price
}

/**
 * Creates an invoice for a report
 * This function handles the full flow: determining pricing, creating the invoice record,
 * and creating line items from the template
 */
export async function createInvoiceForReport(
  supabase: SupabaseClient,
  params: {
    tenantId: string
    jobId: string
    reportId: string
    inspectionId?: string | null
    reportType: string
    propertyType?: string | null
    propertyAddress?: string | null
    claimNumber?: string | null
    jobNumber?: string | null
  }
): Promise<{ invoiceId: string; invoiceRef: string } | null> {
  const {
    tenantId,
    jobId,
    reportId,
    inspectionId,
    reportType,
    propertyType,
    propertyAddress,
    claimNumber,
    jobNumber,
  } = params

  // Fetch job to get client_id
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('client_id')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .single()

  if (jobError || !job?.client_id) {
    console.error('[createInvoiceForReport] Failed to fetch job or client_id:', jobError)
    return null
  }

  // Get invoice type
  const invoiceType = mapReportTypeToInvoiceType(reportType)

  // Get template code
  const templateCode = getInvoiceTemplateCode(reportType, propertyType)

  // Fetch template
  const { data: template, error: templateError } = await supabase
    .from('invoice_templates')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('template_code', templateCode)
    .eq('is_active', true)
    .single()

  if (templateError || !template) {
    console.error('[createInvoiceForReport] Template not found:', templateError)
    return null
  }

  // Get price from client config
  const price = await getReportInvoicePrice(
    supabase,
    tenantId,
    job.client_id,
    reportType,
    propertyType
  )

  // Replace placeholders in description
  let description = template.description
  description = description.replace(/{property_address}/g, propertyAddress || 'N/A')
  description = description.replace(/{claim_number}/g, claimNumber || 'N/A')
  description = description.replace(/{job_number}/g, jobNumber || 'N/A')

  // Calculate GST
  const DEFAULT_GST_PCT = 0.1
  const amountExGst = price
  const gst = Math.round(amountExGst * DEFAULT_GST_PCT * 100) / 100
  const amountIncGst = Math.round((amountExGst + gst) * 100) / 100

  // Generate invoice ref
  const { data: existingInvoices } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('job_id', jobId)
    .eq('direction', 'outbound')

  const sequence = String((existingInvoices?.length ?? 0) + 1)
  const invoiceRef = `INV-${jobNumber || jobId}-${sequence}`

  // Create invoice
  const { data: invoice, error: insertError } = await supabase
    .from('invoices')
    .insert({
      tenant_id: tenantId,
      job_id: jobId,
      report_id: reportId,
      inspection_id: inspectionId || null,
      invoice_ref: invoiceRef,
      invoice_type: invoiceType,
      direction: 'outbound',
      gst_treatment: 'exclusive',
      amount_ex_gst: amountExGst,
      gst,
      amount_inc_gst: amountIncGst,
      status: 'draft',
    })
    .select('id')
    .single()

  if (insertError || !invoice) {
    console.error('[createInvoiceForReport] Failed to create invoice:', insertError)
    return null
  }

  // Create line item
  const { error: lineItemError } = await supabase
    .from('invoice_line_items')
    .insert({
      tenant_id: tenantId,
      invoice_id: invoice.id,
      description,
      quantity: 1,
      unit_price: amountExGst,
      line_total: amountExGst,
      sort_order: 0,
    })

  if (lineItemError) {
    console.error('[createInvoiceForReport] Failed to create line item:', lineItemError)
    // Rollback invoice
    await supabase.from('invoices').delete().eq('id', invoice.id)
    return null
  }

  console.log(`[createInvoiceForReport] Created invoice ${invoiceRef} for report ${reportType}`)
  
  return { invoiceId: invoice.id, invoiceRef }
}
