import { generateBuildingContractHtml } from '@/lib/documents/building-contract-html'
import { renderHtmlToPdf } from '@/lib/pdf/render-html-to-pdf'
import { filenamePart, loadPublicImageDataUri } from '@/lib/documents/document-assets'
import {
  loadQuoteDocumentData,
  type QuoteDocumentContext,
  type QuoteDocumentData,
} from '@/lib/documents/quote-document-data'

// Building Contract PDF (WA, work valued over $7,500) — data loading +
// rendering behind one function boundary, the same pattern as
// lib/work-orders/work-order-pdf.ts. Nothing here writes to the database or
// storage.

export interface BuildingContractPdfResult {
  pdf: Buffer
  filename: string
  data: QuoteDocumentData
}

export interface BuildingContractPdfOptions {
  /** Add invisible e-signing field markers (see BUILDING_CONTRACT_MARKERS) */
  signingMarkers?: boolean
  /** Reject quotes that aren't approved */
  requireApproved?: boolean
}

export function buildingContractPdfFilename(data: Pick<QuoteDocumentData, 'job'>): string {
  const parts = [
    'Building Contract',
    filenamePart(data.job.job_number),
    filenamePart(data.job.property_address).slice(0, 80),
  ].filter(Boolean)
  return `${parts.join(' - ')}.pdf`
}

// The template lays out its own A4 pages, so the PDF has no page margin.
// Two schedule pages run slightly taller than A4, so each page is laid out
// a little wider and zoomed back to 210mm — the same layout, about 8%
// smaller — keeping every template page on one sheet.
const PAGE_ZOOM = 0.9
const PDF_PAGE_CSS = `<style>
  @page { size: A4; margin: 0; }
  .page { min-height: 0 !important; width: ${(210 / PAGE_ZOOM).toFixed(2)}mm !important; zoom: ${PAGE_ZOOM}; }
  .page-break { height: 0; }
</style>`

export async function buildBuildingContractPdf(
  jobId: string,
  quoteIds: string[],
  ctx: QuoteDocumentContext,
  options: BuildingContractPdfOptions = {},
): Promise<BuildingContractPdfResult> {
  const data = await loadQuoteDocumentData(jobId, quoteIds, ctx, { requireApproved: options.requireApproved })
  const [logoSrc, contractorSignatureSrc] = await Promise.all([
    loadPublicImageDataUri('logo-alt.png'),
    loadPublicImageDataUri('signature.png'),
  ])

  const html = generateBuildingContractHtml({
    quotes: data.quotes,
    job: data.job,
    scopeItems: data.scopeItems,
    render: {
      logoSrc: logoSrc ?? undefined,
      contractorSignatureSrc: contractorSignatureSrc ?? undefined,
      signingMarkers: options.signingMarkers,
    },
  }).replace('</head>', `${PDF_PAGE_CSS}</head>`)

  const pdf = await renderHtmlToPdf(html, { margin: '0' })
  return { pdf, filename: buildingContractPdfFilename(data), data }
}

/** Reusable entry point: the PDF bytes only. */
export async function generateBuildingContractPdf(
  jobId: string,
  quoteIds: string[],
  ctx: QuoteDocumentContext,
): Promise<Buffer> {
  return (await buildBuildingContractPdf(jobId, quoteIds, ctx)).pdf
}
