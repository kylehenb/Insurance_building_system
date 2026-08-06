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
interface QuoteRow { approved_amount: number | null; total_amount: number; gst_pct: number | null }

export interface JobContext {
  job: JobMeta
  barReport: ReportRow | null
  makeSafeReport: ReportRow | null
  roofReport: ReportRow | null
  leakDetectionReport: ReportRow | null
  approvedQuote: QuoteRow | null
  approvedQuotes: QuoteRow[]
  hasAdditionalItems: boolean
  invoicedReportTypes: string[]
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
        .from('reports')
        .select('id, report_type')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .eq('report_type', 'make_safe')
        .limit(1)
        .maybeSingle(),
      supabase
        .from('reports')
        .select('id, report_type')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .in('report_type', ['roof', 'storm_wind'])
        .limit(1)
        .maybeSingle(),
      supabase
        .from('reports')
        .select('id, report_type')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .eq('report_type', 'leak_detection')
        .limit(1)
        .maybeSingle(),
      fetch(`/api/quotes?jobId=${encodeURIComponent(jobId)}&tenantId=${encodeURIComponent(tenantId)}`).then(r => r.ok ? r.json() : []),
      supabase
        .from('invoices')
        .select('invoice_type')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .neq('status', 'voided'),
      supabase
        .from('work_orders')
        .select('notes')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId),
    ]).then(([jobRes, barRes, makeSafeRes, roofRes, leakRes, quotesData, invoicesRes, workOrdersRes]) => {
      if (!jobRes.data) return
      const quotes: any[] = Array.isArray(quotesData) ? quotesData : []
      const approvedQuotes = quotes.filter((q: any) => q.status === 'approved' || q.status === 'partially_approved')
      const approvedQuote = approvedQuotes[0] ?? null
      const invoicedTypes = (invoicesRes.data ?? []).map((i: any) => i.invoice_type)
      const hasAdditionalItems = (workOrdersRes.data ?? []).some((wo: any) => {
        if (!wo.notes) return false
        try {
          const parsed = JSON.parse(wo.notes) as Record<string, unknown>
          return Array.isArray(parsed.added_items) && (parsed.added_items as unknown[]).length > 0
        } catch { return false }
      })
      setCtx({
        job: jobRes.data as JobMeta,
        barReport: barRes.data as ReportRow | null,
        makeSafeReport: makeSafeRes.data as ReportRow | null,
        roofReport: roofRes.data as ReportRow | null,
        leakDetectionReport: leakRes.data as ReportRow | null,
        approvedQuote: approvedQuote as QuoteRow | null,
        approvedQuotes: approvedQuotes as QuoteRow[],
        hasAdditionalItems,
        invoicedReportTypes: invoicedTypes,
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
