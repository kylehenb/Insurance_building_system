import { printPageContext } from '@/lib/documents/print-page-context'
import { loadReportPrintData, PrintDataError } from '@/lib/documents/print-data'
import { ReportDocument } from '@/components/documents/ReportDocument'
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

  return (
    <ReportDocument
      {...data}
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
