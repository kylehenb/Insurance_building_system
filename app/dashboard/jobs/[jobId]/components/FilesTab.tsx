'use client'

import React from 'react'
import { Upload } from 'lucide-react'

interface FilesTabProps {
  jobId: string
}

export function FilesTab({ jobId: _ }: FilesTabProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 gap-4"
      style={{ fontFamily: 'DM Sans, sans-serif' }}
    >
      <p className="text-[13px] text-[#9e998f]">No files attached.</p>
      <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#e0dbd4] text-[13px] text-[#9e998f] hover:bg-[#f5f2ee] cursor-pointer transition-colors">
        <Upload className="h-4 w-4" />
        Upload file
        <input type="file" className="sr-only" />
      </label>
    </div>
  )
}
