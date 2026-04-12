'use client'

interface DraftWatermarkProps {
  show: boolean
}

export function DraftWatermark({ show }: DraftWatermarkProps) {
  if (!show) return null

  return (
    <div className="fixed inset-0 pointer-events-none flex items-center justify-center print:hidden z-40">
      <div className="text-[#d0d0d0] text-9xl font-bold opacity-20 rotate-[-45deg] whitespace-nowrap">
        DRAFT
      </div>
    </div>
  )
}
