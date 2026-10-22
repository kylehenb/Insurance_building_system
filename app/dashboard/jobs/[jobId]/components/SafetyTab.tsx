'use client'

import React from 'react'

interface SafetyTabProps {
  jobId: string
}

export function SafetyTab({ jobId: _ }: SafetyTabProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 gap-4"
      style={{ fontFamily: 'DM Sans, sans-serif' }}
    >
      <p className="text-[13px] text-subtle">No safety records.</p>
      <button
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-line text-[13px] text-subtle hover:bg-surface transition-colors"
      >
        + Add record
      </button>
    </div>
  )
}
