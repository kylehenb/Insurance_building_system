'use client'

import React from 'react'
import { ReportsTab } from '@/components/reports/ReportsTab'

interface ReportsTabWrapperProps {
  jobId: string
  tenantId: string
  currentUserId: string
  currentUserRole: string
}

export function ReportsTabWrapper({
  jobId,
  tenantId,
  currentUserId,
  currentUserRole,
}: ReportsTabWrapperProps) {
  return (
    <div>
      <ReportsTab
        jobId={jobId}
        tenantId={tenantId}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
      />
    </div>
  )
}
