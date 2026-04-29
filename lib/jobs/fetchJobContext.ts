import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../supabase/database.types'
import type { JobContext } from './getJobStage'
import type { OpenLoop } from './openLoops'

// These fields are added by migrations not yet reflected in database.types.ts.
// Once database.types.ts is regenerated the casts through unknown can be removed.
type JobRow = {
  id: string
  override_stage: 'on_hold' | 'cancelled' | null
  current_stage: string | null
  current_stage_updated_at: string | null
  homeowner_signoff_sent_at: string | null
  homeowner_signoff_received_at: string | null
  completion_approved_at: string | null
}

type InspectionRow = {
  id: string
  status: string | null
  form_submitted_at: string | null
  no_show_count: number
  last_no_show_at: string | null
}

type ReportRow = {
  id: string
  report_type: string
  status: string | null
  version: number
}

export async function fetchJobContext(
  jobId: string,
  supabaseClient: SupabaseClient<Database>
): Promise<JobContext> {
  const [
    jobResult,
    insurerOrdersResult,
    inspectionResult,
    quoteResult,
    reportResult,
    workOrderVisitsResult,
    tradeInvoicesResult,
    outboundInvoicesResult,
  ] = await Promise.all([
    supabaseClient
      .from('jobs')
      .select('id, override_stage, current_stage, current_stage_updated_at, homeowner_signoff_sent_at, homeowner_signoff_received_at, completion_approved_at')
      .eq('id', jobId)
      .single(),

    supabaseClient
      .from('insurer_orders')
      .select('status')
      .eq('job_id', jobId),

    supabaseClient
      .from('inspections')
      .select('id, status, form_submitted_at, no_show_count, last_no_show_at')
      .eq('job_id', jobId),

    supabaseClient
      .from('quotes')
      .select('status')
      .eq('job_id', jobId)
      .eq('quote_type', 'inspection')
      .eq('is_active_version', true)
      .limit(1),

    supabaseClient
      .from('reports')
      .select('id, report_type, status, version')
      .eq('job_id', jobId),

    supabaseClient
      .from('work_order_visits')
      .select('status')
      .eq('job_id', jobId),

    supabaseClient
      .from('invoices')
      .select('status')
      .eq('job_id', jobId)
      .eq('direction', 'inbound'),

    supabaseClient
      .from('invoices')
      .select('status')
      .eq('job_id', jobId)
      .eq('direction', 'outbound'),
  ])

  if (jobResult.error || !jobResult.data) {
    throw new Error(`Failed to fetch job ${jobId}: ${jobResult.error?.message}`)
  }

  // Cast through unknown to accommodate columns added by migration that are
  // not yet reflected in the generated database.types.ts
  const job = jobResult.data as unknown as JobRow
  const inspectionRows = (inspectionResult.data as unknown as InspectionRow[] | null) ?? []
  const quoteRow = quoteResult.data?.[0] ?? null
  const reportRows = (reportResult.data as unknown as ReportRow[] | null) ?? []

  return {
    job: {
      id: job.id,
      override_stage: job.override_stage ?? null,
      current_stage: job.current_stage ?? null,
      current_stage_updated_at: job.current_stage_updated_at ?? null,
      homeowner_signoff_sent_at: job.homeowner_signoff_sent_at,
      homeowner_signoff_received_at: job.homeowner_signoff_received_at,
      completion_approved_at: job.completion_approved_at,
    },
    insurer_orders: (insurerOrdersResult.data ?? []).map((o) => ({ status: o.status ?? '' })),
    inspections: inspectionRows.map((row) => ({
      id: row.id,
      status: row.status ?? '',
      form_submitted_at: row.form_submitted_at ?? null,
      no_show_count: row.no_show_count ?? 0,
      last_no_show_at: row.last_no_show_at ?? null,
    })),
    primary_quote: quoteRow ? { status: quoteRow.status ?? '' } : null,
    reports: reportRows.map((row) => ({
      id: row.id,
      report_type: row.report_type,
      status: row.status ?? '',
      version: row.version,
    })),
    work_order_visits: (workOrderVisitsResult.data ?? []).map((v) => ({
      status: (v as unknown as { status: string }).status ?? '',
    })),
    trade_invoices: (tradeInvoicesResult.data ?? []).map((i) => ({ status: i.status ?? '' })),
    outbound_invoices: (outboundInvoicesResult.data ?? []).map((i) => ({ status: i.status ?? '' })),
    open_loops: [] as OpenLoop[],
  }
}
