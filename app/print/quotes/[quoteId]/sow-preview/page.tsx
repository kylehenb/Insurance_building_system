import { printPageContext } from '@/lib/documents/print-page-context'
import { loadScopePrintData, PrintDataError } from '@/lib/documents/print-data'
import { scopeQuoteIds } from '@/lib/documents/print-document-pdfs'
import { ScopeDocument } from '@/components/documents/ScopeDocument'
import { SowPreviewPrintButton } from './SowPreviewPrintButton'

// The uncosted scope of works for this quote, plus the job's other quotes in
// ?with= (comma-separated ids) — the same document the job's Send emails.
export default async function SowPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ quoteId: string }>
  searchParams: Promise<{ with?: string }>
}) {
  const { quoteId } = await params
  const others = ((await searchParams).with ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 9)
  const ctx = await printPageContext()

  let data
  try {
    data = await loadScopePrintData(scopeQuoteIds({ id: quoteId, quoteIds: others }), ctx)
  } catch (err) {
    if (err instanceof PrintDataError) return <div>{err.message}</div>
    throw err
  }

  const ref = data.quotes.length > 1 ? data.job.job_number : data.quotes[0].quote_ref
  return <ScopeDocument {...data} toolbar={<SowPreviewPrintButton quoteRef={ref} />} />
}
