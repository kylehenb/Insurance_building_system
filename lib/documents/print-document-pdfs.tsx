import { QuoteDocument } from '@/components/documents/QuoteDocument'
import { ReportDocument } from '@/components/documents/ReportDocument'
import { TccDocument } from '@/components/documents/TccDocument'
import { PhotoPagesDocument } from '@/components/documents/PhotoPagesDocument'
import { loadPhotoImages, renderPrintDocumentPdf } from '@/lib/documents/render-print-document'
import { layoutPhotoPages } from '@/lib/documents/photo-layout'
import { filenamePart } from '@/lib/documents/document-assets'
import {
  loadPhotosPrintData,
  loadQuotePrintData,
  loadReportPrintData,
  loadTccPrintData,
  type PrintDataContext,
  type PhotosPrintData,
  type QuotePrintData,
  type ReportPrintData,
  type TccCallDetails,
  type TccPrintData,
} from '@/lib/documents/print-data'

// PDFs of the quote, report, TCC and photo pages — the same components and
// data as the browser print pages (/print/...), rendered server-side, except
// the photo pages, which have their own layout (renderPhotoPagesPdf). Nothing
// here writes to the database or storage.

export interface PrintDocumentPdf<T> {
  pdf: Buffer
  filename: string
  data: T
}

function pdfFilename(...parts: (string | null | undefined)[]): string {
  return `${parts.map(filenamePart).filter(Boolean).join(' - ')}.pdf`
}

const address = (value: string | null | undefined) => filenamePart(value).slice(0, 80)

// ── Quote ────────────────────────────────────────────────────────────────

export function quotePdfFilename(data: Pick<QuotePrintData, 'quote' | 'job'>): string {
  return pdfFilename('Quote', data.quote.quote_ref || 'Draft', address(data.job.property_address))
}

export async function buildQuotePdf(quoteId: string, ctx: PrintDataContext): Promise<PrintDocumentPdf<QuotePrintData>> {
  const data = await loadQuotePrintData(quoteId, ctx)
  const filename = quotePdfFilename(data)
  const pdf = await renderPrintDocumentPdf(<QuoteDocument {...data} />, data.quote.quote_ref || 'Quote')
  return { pdf, filename, data }
}

// ── Report ───────────────────────────────────────────────────────────────

/** The title the report prints under (matches the report's own heading). */
export function reportDocumentName(reportType: string): string {
  if (reportType === 'LDR') return 'Leak Detection Report'
  if (reportType === 'roof') return 'Roof Report'
  if (reportType === 'make_safe') return 'Make Safe Report'
  return 'Building Assessment Report'
}

export function reportPdfFilename(data: Pick<ReportPrintData, 'report' | 'job'>): string {
  return pdfFilename(reportDocumentName(data.report.report_type), data.report.report_ref, address(data.job.property_address))
}

export async function buildReportPdf(reportId: string, ctx: PrintDataContext): Promise<PrintDocumentPdf<ReportPrintData>> {
  const data = await loadReportPrintData(reportId, ctx)
  const filename = reportPdfFilename(data)
  const pdf = await renderPrintDocumentPdf(<ReportDocument {...data} />, data.report.report_ref || 'Report')
  return { pdf, filename, data }
}

// ── Telephone Clearance Certificate ──────────────────────────────────────

export function tccPdfFilename(data: Pick<TccPrintData, 'job'>): string {
  return pdfFilename('Telephone Clearance Certificate', `TCC-${data.job.job_number}`, address(data.job.property_address))
}

export async function buildTccPdf(quoteId: string, call: TccCallDetails, ctx: PrintDataContext): Promise<PrintDocumentPdf<TccPrintData>> {
  const data = await loadTccPrintData(quoteId, call, ctx)
  const filename = tccPdfFilename(data)
  const pdf = await renderPrintDocumentPdf(<TccDocument {...data} />, `TCC-${data.job.job_number}`)
  return { pdf, filename, data }
}

// ── Job photos ───────────────────────────────────────────────────────────

export function photosPdfFilename(data: Pick<PhotosPrintData, 'job'>): string {
  return pdfFilename('Photos', data.job.job_number, address(data.job.property_address))
}

/**
 * The photo pages PDF: rows fitted to each photo's shape (nothing cropped),
 * numbered labels. Unlike the other documents this is not the print page's
 * layout — the print page keeps the older grid until it is retired.
 */
export async function renderPhotoPagesPdf(data: PhotosPrintData): Promise<Buffer> {
  const images = await loadPhotoImages(data.photos.map(p => p.storage_path))
  const pages = layoutPhotoPages(data.photos.map((p, i) => ({
    aspect: images[i]?.width && images[i]?.height ? images[i]!.width / images[i]!.height : NaN,
    label: p.label,
  })))
  const photos = data.photos.map((p, i) => ({ number: i + 1, label: p.label?.trim() || null, src: images[i]?.src ?? null }))
  return renderPrintDocumentPdf(<PhotoPagesDocument job={data.job} photos={photos} pages={pages} />, `Photos ${data.job.job_number}`)
}

export async function buildPhotosPdf(jobId: string, photoIds: string[], ctx: PrintDataContext): Promise<PrintDocumentPdf<PhotosPrintData>> {
  const data = await loadPhotosPrintData(jobId, photoIds, ctx)
  const filename = photosPdfFilename(data)
  const pdf = await renderPhotoPagesPdf(data)
  return { pdf, filename, data }
}
