import { printPageContext } from '@/lib/documents/print-page-context'
import { loadReportPrintData, PrintDataError } from '@/lib/documents/print-data'
import { ReportDocument, reportUsesInsurerTemplate } from '@/components/documents/ReportDocument'
import { PhotoPagesClient } from '@/components/documents/PhotoPagesClient'
import { photoPublicUrl } from '@/lib/documents/photo-layout'
import { PrintButton } from './PrintButton'

export default async function ReportPrintPage({
  params,
}: {
  params: Promise<{ reportId: string }>
}) {
  const { reportId } = await params
  const ctx = await printPageContext()

  let data
  try {
    data = await loadReportPrintData(reportId, ctx)
  } catch (err) {
    if (err instanceof PrintDataError) return <div>{err.message}</div>
    throw err
  }
  const { report, job } = data

  // Photographs: the same fitted photo pages as the report PDF, measured in the browser
  const photoPages = data.photos.length > 0 && !reportUsesInsurerTemplate(report, job)
    ? (
      <PhotoPagesClient
        variant="report"
        reportRef={report.report_ref}
        job={job}
        photos={data.photos.map(p => ({ url: photoPublicUrl(p.storage_path), label: p.label }))}
      />
    )
    : null

  return (
    <ReportDocument
      {...data}
      photoPages={photoPages}
      toolbar={
        <PrintButton
          reportRef={report.report_ref}
          jobNumber={job.job_number}
          reportType={report.report_type}
          insuredName={job.insured_name}
          propertyAddress={job.property_address}
          insurer={job.insurer}
          claimNumber={job.claim_number}
        />
      }
    />
  )
}
