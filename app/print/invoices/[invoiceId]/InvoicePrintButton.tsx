'use client'

export function InvoicePrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="bg-[#3a3530] text-white px-4 py-2 rounded text-sm font-medium hover:bg-[#4a4540] transition-colors"
    >
      Print / Save as PDF
    </button>
  )
}
