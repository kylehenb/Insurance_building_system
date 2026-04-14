'use client'

export function PrintButton({ quoteRef, jobNumber }: { quoteRef?: string | null; jobNumber?: string | null }) {
  const handlePrint = () => {
    const originalTitle = document.title
    const filename = quoteRef || jobNumber || 'Quote'
    document.title = `Quote - ${filename}`
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
