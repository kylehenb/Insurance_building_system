import { printPageContext } from '@/lib/documents/print-page-context'
import { loadTccPrintData, PrintDataError, tccCallDetails } from '@/lib/documents/print-data'
import { TccDocument } from '@/components/documents/TccDocument'
import { PrintButton } from './PrintButton'

export default async function TccPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ quoteId: string }>
  searchParams: Promise<{ date?: string; time?: string; completedBy?: string; method?: string }>
}) {
  const { quoteId } = await params
  const call = tccCallDetails(await searchParams)
  const ctx = await printPageContext()

  let data
  try {
    data = await loadTccPrintData(quoteId, call, ctx)
  } catch (err) {
    if (err instanceof PrintDataError) return <div>{err.message}</div>
    throw err
  }

  return <TccDocument {...data} toolbar={<PrintButton jobNumber={data.job.job_number} />} />
}
