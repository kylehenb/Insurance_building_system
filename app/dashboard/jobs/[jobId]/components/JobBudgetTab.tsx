'use client'

import React from 'react'

interface JobBudgetTabProps {
  jobId: string
}

export function JobBudgetTab({ jobId: _ }: JobBudgetTabProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16"
      style={{ fontFamily: 'DM Sans, sans-serif' }}
    >
      <p className="text-[13px] text-[#9e998f]">
        Budget tracking available once a quote is approved.
      </p>
    </div>
  )
}
