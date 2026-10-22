import type { ReactNode } from 'react'
import { generateInvoiceHtml } from '@/lib/documents/invoice-html'
import type { InvoicePrintData } from '@/lib/documents/print-data'

// Invoices. The invoice body comes from lib/documents/invoice-html.ts; this
// is the page around it. Rendered by the browser print page
// (/print/invoices/[invoiceId]) and, as static HTML, by the emailed PDF
// (lib/documents/invoice-pdf.ts) — one layout for both.

export interface InvoiceDocumentProps extends InvoicePrintData {
  /** Print page controls (hidden when printing). Omitted in the PDF. */
  toolbar?: ReactNode
}

export function InvoiceDocument({ invoice, job, tenant, lineItems, deductions, approvedQuoteRefs, toolbar }: InvoiceDocumentProps) {
  const html = generateInvoiceHtml({
    invoice,
    job,
    tenant,
    lineItems,
    deductions,
    approvedQuoteRefs,
  })

  return (
    <div className="min-h-screen bg-[#f5f2ee] print:bg-white">
      {/* Print controls */}
      <div className="max-w-4xl mx-auto bg-white shadow-lg min-h-screen print:shadow-none print:min-h-0 relative">
        {/* Print button - hidden when printing */}
        {toolbar && (
          <div className="no-print absolute top-4 right-4 z-10 print:hidden">
            {toolbar}
          </div>
        )}

        {/* Render HTML */}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}
