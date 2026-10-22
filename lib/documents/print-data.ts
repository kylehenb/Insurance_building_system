import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

// Data for the documents that started life as browser print pages (quote,
// invoice, report, telephone clearance certificate, photo pages). The print
// pages and the emailed PDFs load through these, so both show the same data.
// Read-only.

type Quote = Database['public']['Tables']['quotes']['Row']
type ScopeItem = Database['public']['Tables']['scope_items']['Row']
type Report = Database['public']['Tables']['reports']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type Photo = Database['public']['Tables']['photos']['Row']
type Invoice = Database['public']['Tables']['invoices']['Row']
type InvoiceLineItem = Database['public']['Tables']['invoice_line_items']['Row']
type InvoiceDeduction = Database['public']['Tables']['invoice_deductions']['Row']

export interface PrintDataContext {
  /** The signed-in user's client (RLS applies) or the service client — tenantId is always enforced. */
  supabase: SupabaseClient<Database>
  tenantId: string
}

/** Message is what the print page shows in place of the document. */
export class PrintDataError extends Error {
  constructor(message: string, public readonly status: 404 | 500) {
    super(message)
    this.name = 'PrintDataError'
  }
}

async function loadJobAndTenant(ctx: PrintDataContext, jobId: string): Promise<{ job: Job; tenant: Tenant }> {
  const { supabase, tenantId } = ctx
  const { data: job, error: jobError } = await supabase
    .from('jobs').select('*').eq('id', jobId).eq('tenant_id', tenantId).single()
  if (jobError || !job) throw new PrintDataError('Job not found', 404)

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants').select('*').eq('id', tenantId).single()
  if (tenantError || !tenant) throw new PrintDataError('Tenant not found', 404)
  return { job, tenant }
}

// ── Quote ────────────────────────────────────────────────────────────────

export interface QuotePrintData {
  quote: Quote
  scopeItems: ScopeItem[]
  job: Job
  tenant: Tenant
}

export async function loadQuotePrintData(quoteId: string, ctx: PrintDataContext): Promise<QuotePrintData> {
  const { supabase, tenantId } = ctx
  const { data: quote, error: quoteError } = await supabase
    .from('quotes').select('*').eq('id', quoteId).eq('tenant_id', tenantId).single()
  if (quoteError || !quote) throw new PrintDataError('Quote not found', 404)

  const { data: scopeItems, error: itemsError } = await supabase
    .from('scope_items').select('*').eq('quote_id', quoteId).eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })
  if (itemsError) throw new PrintDataError('Error fetching scope items', 500)

  const { job, tenant } = await loadJobAndTenant(ctx, quote.job_id)
  return { quote, scopeItems: scopeItems ?? [], job, tenant }
}

// ── Invoice ──────────────────────────────────────────────────────────────

export interface InvoicePrintData {
  invoice: Invoice
  lineItems: InvoiceLineItem[]
  /** e.g. policy excess already paid, deducted post-GST */
  deductions: InvoiceDeduction[]
  job: Job
  tenant: Tenant
  /** quoted_amounts invoices: the approved quote refs for the clause statement */
  approvedQuoteRefs: string[]
}

export async function loadInvoicePrintData(invoiceId: string, ctx: PrintDataContext): Promise<InvoicePrintData> {
  const { supabase, tenantId } = ctx
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices').select('*').eq('id', invoiceId).eq('tenant_id', tenantId).single()
  if (invoiceError || !invoice) throw new PrintDataError('Invoice not found', 404)

  const { data: lineItems, error: itemsError } = await supabase
    .from('invoice_line_items').select('*').eq('invoice_id', invoiceId).eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })
  if (itemsError) throw new PrintDataError('Error fetching line items', 500)

  const { data: deductions } = await supabase
    .from('invoice_deductions').select('*').eq('invoice_id', invoiceId).eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  const { job, tenant } = await loadJobAndTenant(ctx, invoice.job_id)

  let approvedQuoteRefs: string[] = []
  if (invoice.invoice_type === 'quoted_amounts') {
    const { data: quotes } = await supabase
      .from('quotes').select('quote_ref').eq('job_id', invoice.job_id).eq('tenant_id', tenantId)
      .in('status', ['approved', 'partially_approved']).order('created_at', { ascending: true })
    approvedQuoteRefs = (quotes ?? []).map(q => q.quote_ref).filter((r): r is string => !!r)
  }

  return { invoice, lineItems: lineItems ?? [], deductions: deductions ?? [], job, tenant, approvedQuoteRefs }
}

// ── Report ───────────────────────────────────────────────────────────────

export interface ReportPrintData {
  report: Report
  job: Job
  tenant: Tenant
  /** Photos attached to this report, in sequence */
  photos: Photo[]
}

export async function loadReportPrintData(reportId: string, ctx: PrintDataContext): Promise<ReportPrintData> {
  const { supabase, tenantId } = ctx
  const { data: report, error: reportError } = await supabase
    .from('reports').select('*').eq('id', reportId).eq('tenant_id', tenantId).single()
  if (reportError || !report) throw new PrintDataError('Report not found', 404)

  const { job, tenant } = await loadJobAndTenant(ctx, report.job_id)

  const { data: photos } = await supabase
    .from('photos').select('*').eq('report_id', reportId).eq('tenant_id', tenantId)
    .order('sequence_number', { ascending: true })

  return { report, job, tenant, photos: photos ?? [] }
}

// ── Telephone Clearance Certificate ──────────────────────────────────────

/** Call details entered in the TCC dialog (passed to the print page as query params). */
export interface TccCallDetails {
  date: string
  time: string
  completedBy: string
  method: string
}

export interface TccPrintData {
  job: Job
  tenant: Tenant
  call: TccCallDetails
}

export function tccCallDetails(input: Partial<Record<keyof TccCallDetails, unknown>>): TccCallDetails {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return { date: str(input.date), time: str(input.time), completedBy: str(input.completedBy), method: str(input.method) }
}

export async function loadTccPrintData(quoteId: string, call: TccCallDetails, ctx: PrintDataContext): Promise<TccPrintData> {
  const { supabase, tenantId } = ctx
  const { data: quote } = await supabase
    .from('quotes').select('*').eq('id', quoteId).eq('tenant_id', tenantId).single()
  if (!quote) throw new PrintDataError('Quote not found', 404)

  const { job, tenant } = await loadJobAndTenant(ctx, quote.job_id)
  return { job, tenant, call }
}

// ── Job photos ───────────────────────────────────────────────────────────

export type PhotoPageItem = Pick<Photo, 'id' | 'storage_path' | 'label' | 'file_name' | 'crop_x' | 'crop_y' | 'crop_scale' | 'uploaded_at'>

export interface PhotosPrintData {
  job: Pick<Job, 'job_number' | 'insured_name' | 'property_address' | 'claim_number'>
  /** In the order chosen (selected ids), else upload order */
  photos: PhotoPageItem[]
}

/** Comma-separated photo ids, as the Photos tab passes them. */
export function parsePhotoIds(value: unknown): string[] {
  return typeof value === 'string' ? value.split(',').filter(Boolean) : []
}

export async function loadPhotosPrintData(jobId: string, selectedIds: string[], ctx: PrintDataContext): Promise<PhotosPrintData> {
  const { supabase, tenantId } = ctx
  const { data: job } = await supabase
    .from('jobs').select('job_number, insured_name, property_address, claim_number')
    .eq('id', jobId).eq('tenant_id', tenantId).single()
  if (!job) throw new PrintDataError('Job not found', 404)

  let query = supabase
    .from('photos')
    .select('id, storage_path, label, file_name, crop_x, crop_y, crop_scale, uploaded_at')
    .eq('job_id', jobId)
    .eq('tenant_id', tenantId)
    .order('uploaded_at', { ascending: true })
  if (selectedIds.length > 0) query = query.in('id', selectedIds)

  const { data: photos } = await query
  const allPhotos = photos ?? []
  const ordered = selectedIds.length > 0
    ? selectedIds.map(id => allPhotos.find(p => p.id === id)).filter((p): p is NonNullable<typeof p> => p != null)
    : allPhotos
  return { job, photos: ordered }
}
