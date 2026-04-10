'use client'

import React, { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { QuotesList } from '../quotes/components/QuotesList'

interface QuotesTabProps {
  jobId: string
  tenantId: string
}

export function QuotesTab({ jobId, tenantId }: QuotesTabProps) {
  const [job, setJob] = useState<{ job_number: string; insurer: string | null; insured_name: string | null; property_address: string | null } | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    void supabase
      .from('jobs')
      .select('job_number, insurer, insured_name, property_address')
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .single()
      .then(({ data }) => {
        setJob(data ?? { job_number: '', insurer: null, insured_name: null, property_address: null })
        setReady(true)
      })
  }, [jobId, tenantId])

  if (!ready || !job) {
    return (
      <div
        style={{
          padding: '32px 0',
          textAlign: 'center',
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 13,
          color: '#9e998f',
        }}
      >
        Loading…
      </div>
    )
  }

  return <QuotesList jobId={jobId} tenantId={tenantId} insurer={job.insurer} job={job} />
}
