'use client'

import React, { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { InvoicesList } from './InvoicesList'

interface InvoicesTabProps {
  jobId: string
  tenantId: string
}

interface JobMeta {
  job_number: string
  insurer: string | null
  insured_name: string | null
  property_address: string | null
  excess: number | null
  claim_number: string | null
}

interface ReportRow { id: string; report_type: string }
interface WorkOrderRow { id: string; work_order_type: string }
interface QuoteRow { approved_amount: number | null; gst_pct: number | null }

export interface JobContext {
  job: JobMeta
  barReport: ReportRow | null
  makeSafeWorkOrder: WorkOrderRow | null
  approvedQuote: QuoteRow | null
}

export function InvoicesTab({ jobId, tenantId }: InvoicesTabProps) {
  const [ctx, setCtx] = useState<JobContext | null>(null)

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    void Promise.all([
      supabase
        .from('jobs')
        .select('job_number, insurer, insured_name, property_address, excess, claim_number')
        .eq('id', jobId)
        .eq('tenant_id', tenantId)
        .single(),
      supabase
        .from('reports')
        .select('id, report_type')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .eq('report_type', 'BAR')
        .limit(1)
        .maybeSingle(),
      supabase
        .from('work_orders')
        .select('id, work_order_type')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .eq('work_order_type', 'make_safe')
        .limit(1)
        .maybeSingle(),
      supabase
        .from('quotes')
        .select('approved_amount, gst_pct')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]).then(([jobRes, reportRes, woRes, quoteRes]) => {
      if (!jobRes.data) return
      setCtx({
        job: jobRes.data as JobMeta,
        barReport: reportRes.data as ReportRow | null,
        makeSafeWorkOrder: woRes.data as WorkOrderRow | null,
        approvedQuote: quoteRes.data as QuoteRow | null,
      })
    })
  }, [jobId, tenantId])

  if (!ctx) {
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

  return <InvoicesList jobId={jobId} tenantId={tenantId} ctx={ctx} />
}
