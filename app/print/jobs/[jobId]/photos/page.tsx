import { printPageContext } from '@/lib/documents/print-page-context'
import { loadPhotosPrintData, parsePhotoIds, PrintDataError } from '@/lib/documents/print-data'
import { PhotoPagesClient } from '@/components/documents/PhotoPagesClient'
import { photoPublicUrl } from '@/lib/documents/photo-layout'
import { PrintButton } from './PrintButton'

// Same photo pages as the emailed Photos PDF; the photos are measured in the
// browser to lay them out (PhotoPagesClient).
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
    <div className="min-h-screen bg-[#f5f2ee] py-6 print:bg-white print:p-0">
      <PrintButton jobNumber={data.job.job_number} insuredName={data.job.insured_name} />
      <div className="mx-auto bg-white shadow-lg print:shadow-none" style={{ width: '718px' }}>
        {data.photos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '64px', color: '#9e998f', fontSize: '14px' }}>
            No photos to display
          </div>
        ) : (
          <PhotoPagesClient
            job={data.job}
            photos={data.photos.map(p => ({ url: photoPublicUrl(p.storage_path), label: p.label }))}
          />
        )}
      </div>
    </div>
  )
}
