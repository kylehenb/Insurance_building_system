import { printPageContext } from '@/lib/documents/print-page-context'
import { loadQuotePrintData, PrintDataError } from '@/lib/documents/print-data'
import { QuoteDocument } from '@/components/documents/QuoteDocument'
import { PrintButton } from './PrintButton'

export default async function QuotePrintPage({
  params,
}: {
  params: Promise<{ quoteId: string }>
}) {
  const { quoteId } = await params
  const ctx = await printPageContext()

  let data
  try {
    data = await loadQuotePrintData(quoteId, ctx)
  } catch (err) {
    if (err instanceof PrintDataError) return <div>{err.message}</div>
    throw err
  }

  return (
    <QuoteDocument
      {...data}
      toolbar={<PrintButton quoteRef={data.quote.quote_ref} jobNumber={data.job.job_number} />}
    />
  )
}
