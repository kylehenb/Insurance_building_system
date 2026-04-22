'use client'

export function InvoicePrintButton({ invoiceRef }: { invoiceRef?: string | null }) {
  const handlePrint = () => {
    const originalTitle = document.title
    if (invoiceRef) {
      document.title = `Invoice-${invoiceRef}`
    }
    window.print()
    document.title = originalTitle
  }

  return (
    <button
      onClick={handlePrint}
      className="bg-[#3a3530] text-white px-4 py-2 rounded text-sm font-medium hover:bg-[#4a4540] transition-colors"
    >
      Print / Save as PDF
    </button>
  )
}
