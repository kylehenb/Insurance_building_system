import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { generateInvoiceHtml } from '@/lib/documents/invoice-html'
import { renderHtmlToPdf } from '@/lib/pdf/render-html-to-pdf'
import { filenamePart, loadPublicImageDataUri, loadTenantLogoDataUri } from '@/lib/documents/document-assets'

// Invoice PDF — data loading + rendering behind one function boundary, the
// same pattern as lib/work-orders/work-order-pdf.ts. Uses the same template
// as the browser print page (/print/invoices/[invoiceId]). Nothing here writes
// to the database or storage.

type Invoice = Database['public']['Tables']['invoices']['Row']

export interface InvoicePdfContext {
  /** The signed-in user's client (RLS applies) or the service client — tenantId is always enforced. */
  supabase: SupabaseClient<Database>
  tenantId: string
}

export class InvoicePdfError extends Error {
  constructor(message: string, public readonly status: 404 | 500) {
    super(message)
    this.name = 'InvoicePdfError'
  }
}

export interface InvoicePdfResult {
  pdf: Buffer
  filename: string
  invoice: Invoice
}

export function invoicePdfFilename(invoice: Pick<Invoice, 'invoice_ref' | 'invoice_type' | 'id'>, propertyAddress: string | null): string {
  const label = invoice.invoice_type === 'excess' ? 'Excess Invoice' : 'Invoice'
  const parts = [
    label,
    filenamePart(invoice.invoice_ref) || invoice.id.slice(0, 8).toUpperCase(),
    filenamePart(propertyAddress).slice(0, 80),
  ].filter(Boolean)
  return `${parts.join(' - ')}.pdf`
}

export async function buildInvoicePdf(invoiceId: string, ctx: InvoicePdfContext): Promise<InvoicePdfResult> {
  const { supabase, tenantId } = ctx

  const { data: invoice } = await supabase
    .from('invoices').select('*').eq('id', invoiceId).eq('tenant_id', tenantId).maybeSingle()
  if (!invoice) throw new InvoicePdfError('Invoice not found', 404)

  const [itemsRes, deductionsRes, jobRes, tenantRes, quotesRes] = await Promise.all([
    supabase.from('invoice_line_items').select('*').eq('invoice_id', invoiceId).eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true }),
    supabase.from('invoice_deductions').select('*').eq('invoice_id', invoiceId).eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true }),
    supabase.from('jobs').select('*').eq('id', invoice.job_id).eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
    invoice.invoice_type === 'quoted_amounts'
      ? supabase.from('quotes').select('quote_ref').eq('job_id', invoice.job_id).eq('tenant_id', tenantId)
          .in('status', ['approved', 'partially_approved']).order('created_at', { ascending: true })
      : Promise.resolve({ data: [] as { quote_ref: string | null }[] }),
  ])
  const job = jobRes.data
  const tenant = tenantRes.data
  if (!job) throw new InvoicePdfError('Job not found', 404)
  if (!tenant) throw new InvoicePdfError('Tenant not found', 404)

  const [logoSrc, footerLogoSrc] = await Promise.all([
    loadPublicImageDataUri('logo-alt.png'),
    loadTenantLogoDataUri(tenant.logo_storage_path),
  ])

  const html = generateInvoiceHtml({
    invoice,
    job,
    tenant,
    lineItems: itemsRes.data ?? [],
    deductions: deductionsRes.data ?? [],
    approvedQuoteRefs: (quotesRes.data ?? []).map(q => q.quote_ref).filter((r): r is string => !!r),
    render: { logoSrc: logoSrc ?? undefined, footerLogoSrc },
  })

  const pdf = await renderHtmlToPdf(html, { margin: '10mm' })
  return { pdf, filename: invoicePdfFilename(invoice, job.property_address), invoice }
}

/** Reusable entry point: the PDF bytes only. */
export async function generateInvoicePdf(invoiceId: string, ctx: InvoicePdfContext): Promise<Buffer> {
  return (await buildInvoicePdf(invoiceId, ctx)).pdf
}
