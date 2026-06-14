'use client'

const REPORT_TYPE_LABELS: Record<string, string> = {
  roof: 'Roof Report',
  BAR: 'Building Assessment Report',
  storm_wind: 'Building Assessment Report',
  LDR: 'Leak Detection Report',
  make_safe: 'Make Safe Report',
}

export function PrintButton({
  reportRef,
  jobNumber,
  reportType,
  insuredName,
  propertyAddress,
  insurer,
  claimNumber,
}: {
  reportRef?: string | null
  jobNumber?: string | null
  reportType?: string | null
  insuredName?: string | null
  propertyAddress?: string | null
  insurer?: string | null
  claimNumber?: string | null
}) {
  const handlePrint = () => {
    const originalTitle = document.title
    const typeLabel = (reportType && REPORT_TYPE_LABELS[reportType]) || 'Report'
    const parts = [insuredName, propertyAddress, insurer, claimNumber].filter(Boolean)
    const filename = parts.length > 0
      ? `${typeLabel} - ${parts.join(', ')}`
      : `${typeLabel} - ${reportRef || jobNumber || 'Report'}`
    document.title = filename
    window.print()
    document.title = originalTitle
  }

  return (
    <button
      onClick={handlePrint}
      className="fixed top-4 right-4 z-50 bg-[#1a1a1a] text-[#f5f0e8] px-4 py-2 rounded-lg font-medium hover:bg-[#333] transition-colors print:hidden"
    >
      Print / Save as PDF
    </button>
  )
}
