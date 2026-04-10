'use client'

import React from 'react'

interface InvoicesTabProps {
  jobId: string
}

export function InvoicesTab({ jobId: _ }: InvoicesTabProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16"
      style={{ fontFamily: 'DM Sans, sans-serif' }}
    >
      <p className="text-[13px] text-[#9e998f]">No invoices yet.</p>
    </div>
  )
}
