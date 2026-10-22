import { printPageContext } from '@/lib/documents/print-page-context'
import { loadInvoicePrintData, PrintDataError } from '@/lib/documents/print-data'
import { InvoiceDocument } from '@/components/documents/InvoiceDocument'
import { InvoicePrintButton } from './InvoicePrintButton'

export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>
}) {
  const { invoiceId } = await params
  const ctx = await printPageContext()

  let data
  try {
    data = await loadInvoicePrintData(invoiceId, ctx)
  } catch (err) {
    if (err instanceof PrintDataError) return <div>{err.message}</div>
    throw err
  }

  return <InvoiceDocument {...data} toolbar={<InvoicePrintButton invoiceRef={data.invoice.invoice_ref} />} />
}
