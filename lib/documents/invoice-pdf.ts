import { createElement } from 'react'
import type { Database } from '@/lib/supabase/database.types'
import { InvoiceDocument } from '@/components/documents/InvoiceDocument'
import { renderPrintDocumentPdf } from '@/lib/documents/render-print-document'
import { filenamePart } from '@/lib/documents/document-assets'
import { loadInvoicePrintData, PrintDataError, type InvoicePrintData, type PrintDataContext } from '@/lib/documents/print-data'

// Invoice PDF — the same component and data as the browser print page
// (/print/invoices/[invoiceId]), rendered server-side the way the browser
// prints it (lib/documents/render-print-document.ts). Nothing here writes to
// the database or storage.

type Invoice = Database['public']['Tables']['invoices']['Row']

export type InvoicePdfContext = PrintDataContext

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
  data: InvoicePrintData
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
  let data: InvoicePrintData
  try {
    data = await loadInvoicePrintData(invoiceId, ctx)
  } catch (err) {
    if (err instanceof PrintDataError) throw new InvoicePdfError(err.message, err.status)
    throw err
  }
  const pdf = await renderPrintDocumentPdf(createElement(InvoiceDocument, data), data.invoice.invoice_ref || 'Invoice')
  return { pdf, filename: invoicePdfFilename(data.invoice, data.job.property_address), invoice: data.invoice, data }
}

/** Reusable entry point: the PDF bytes only. */
export async function generateInvoicePdf(invoiceId: string, ctx: InvoicePdfContext): Promise<Buffer> {
  return (await buildInvoicePdf(invoiceId, ctx)).pdf
}
