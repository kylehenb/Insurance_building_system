import { generateSowHtml } from '@/lib/documents/sow-html'
import { renderHtmlToPdf } from '@/lib/pdf/render-html-to-pdf'
import { filenamePart, loadPublicImageDataUri, loadTenantLogoDataUri } from '@/lib/documents/document-assets'
import {
  loadQuoteDocumentData,
  type QuoteDocumentContext,
  type QuoteDocumentData,
} from '@/lib/documents/quote-document-data'

// Scope of Works Authorisation PDF (work valued at $7,500 or less) — data
// loading + rendering behind one function boundary, the same pattern as
// lib/work-orders/work-order-pdf.ts. Nothing here writes to the database or
// storage.

export interface ScopeOfWorksPdfResult {
  pdf: Buffer
  filename: string
  data: QuoteDocumentData
}

export interface ScopeOfWorksPdfOptions {
  /** Add invisible e-signing field markers (see SOW_MARKERS) */
  signingMarkers?: boolean
  /** Reject quotes that aren't approved */
  requireApproved?: boolean
}

export function scopeOfWorksReference(data: Pick<QuoteDocumentData, 'job' | 'quotes'>): string {
  return data.quotes.length > 1 ? `${data.job.job_number}-SOW` : `${data.quotes[0].quote_ref ?? data.job.job_number}-SOW`
}

export function scopeOfWorksPdfFilename(data: Pick<QuoteDocumentData, 'job' | 'quotes'>): string {
  const parts = [
    'Scope of Works',
    filenamePart(scopeOfWorksReference(data)),
    filenamePart(data.job.property_address).slice(0, 80),
  ].filter(Boolean)
  return `${parts.join(' - ')}.pdf`
}

export async function buildScopeOfWorksPdf(
  jobId: string,
  quoteIds: string[],
  ctx: QuoteDocumentContext,
  options: ScopeOfWorksPdfOptions = {},
): Promise<ScopeOfWorksPdfResult> {
  const data = await loadQuoteDocumentData(jobId, quoteIds, ctx, { requireApproved: options.requireApproved })
  const [logoSrc, contractorSignatureSrc, footerLogoSrc] = await Promise.all([
    loadPublicImageDataUri('logo-alt.png'),
    loadPublicImageDataUri('signature.png'),
    loadTenantLogoDataUri(data.tenant.logo_storage_path),
  ])

  const html = generateSowHtml({
    quotes: data.quotes,
    job: data.job,
    scopeItems: data.scopeItems,
    tenant: data.tenant,
    render: {
      logoSrc: logoSrc ?? undefined,
      footerLogoSrc,
      contractorSignatureSrc,
      signingMarkers: options.signingMarkers,
    },
  })

  const pdf = await renderHtmlToPdf(html, { margin: '10mm' })
  return { pdf, filename: scopeOfWorksPdfFilename(data), data }
}

/** Reusable entry point: the PDF bytes only. */
export async function generateScopeOfWorksPdf(
  jobId: string,
  quoteIds: string[],
  ctx: QuoteDocumentContext,
): Promise<Buffer> {
  return (await buildScopeOfWorksPdf(jobId, quoteIds, ctx)).pdf
}
