import { printPageContext } from '@/lib/documents/print-page-context'
import { loadPhotosPrintData, parsePhotoIds, PrintDataError } from '@/lib/documents/print-data'
import { PhotosDocument } from '@/components/documents/PhotosDocument'
import { PrintButton } from './PrintButton'

export default async function PhotosPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { jobId } = await params
  const sp = await searchParams
  const ctx = await printPageContext()

  let data
  try {
    data = await loadPhotosPrintData(jobId, parsePhotoIds(sp.ids), ctx)
  } catch (err) {
    if (err instanceof PrintDataError) return <div>{err.message}</div>
    throw err
  }

  return (
    <PhotosDocument
      {...data}
      toolbar={<PrintButton jobNumber={data.job.job_number} insuredName={data.job.insured_name} />}
    />
  )
}
