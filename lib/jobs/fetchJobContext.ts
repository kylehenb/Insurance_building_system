import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../supabase/database.types'
import type { JobContext } from './getJobStage'
import type { OpenLoop } from './openLoops'

// These fields are added by the add_job_stage_fields migration.
// Once database.types.ts is regenerated after applying the migration,
// the casts through unknown can be replaced with direct property access.
type JobRow = {
  id: string
  override_stage: 'on_hold' | 'cancelled' | null
  homeowner_signoff_sent_at: string | null
  homeowner_signoff_received_at: string | null
  completion_approved_at: string | null
}

type InspectionRow = {
  status: string | null
  form_submitted_at: string | null
  no_show_count: number
  last_no_show_at: string | null
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
    blueprintResult,
    workOrderVisitsResult,
    tradeInvoicesResult,
    outboundInvoicesResult,
  ] = await Promise.all([
    supabaseClient
      .from('jobs')
      .select('id, override_stage, homeowner_signoff_sent_at, homeowner_signoff_received_at, completion_approved_at')
      .eq('id', jobId)
      .single(),

    supabaseClient
      .from('insurer_orders')
      .select('status')
      .eq('job_id', jobId),

    supabaseClient
      .from('inspections')
      .select('status, form_submitted_at, no_show_count, last_no_show_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true })
      .limit(1),

    supabaseClient
      .from('quotes')
      .select('status')
      .eq('job_id', jobId)
      .eq('quote_type', 'inspection')
      .eq('is_active_version', true)
      .limit(1),

    supabaseClient
      .from('reports')
      .select('status')
      .eq('job_id', jobId)
      .eq('report_type', 'BAR')
      .order('version', { ascending: true })
      .limit(1),

    supabaseClient
      .from('job_schedule_blueprints')
      .select('status')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(1),

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
  const inspectionRow = (inspectionResult.data as unknown as InspectionRow[] | null)?.[0] ?? null
  const quoteRow = quoteResult.data?.[0] ?? null
  const reportRow = reportResult.data?.[0] ?? null
  const blueprintRow = blueprintResult.data?.[0] ?? null

  return {
    job: {
      id: job.id,
      override_stage: job.override_stage ?? null,
      homeowner_signoff_sent_at: job.homeowner_signoff_sent_at,
      homeowner_signoff_received_at: job.homeowner_signoff_received_at,
      completion_approved_at: job.completion_approved_at,
    },
    insurer_orders: (insurerOrdersResult.data ?? []).map((o) => ({ status: o.status ?? '' })),
    inspection: inspectionRow
      ? {
          status: inspectionRow.status ?? '',
          form_submitted_at: inspectionRow.form_submitted_at ?? null,
          no_show_count: inspectionRow.no_show_count ?? 0,
          last_no_show_at: inspectionRow.last_no_show_at ?? null,
        }
      : null,
    primary_quote: quoteRow ? { status: quoteRow.status ?? '' } : null,
    primary_report: reportRow ? { status: reportRow.status ?? '' } : null,
    blueprint: blueprintRow
      ? { status: (blueprintRow as unknown as { status: string }).status ?? '' }
      : null,
    work_order_visits: (workOrderVisitsResult.data ?? []).map((v) => ({
      status: (v as unknown as { status: string }).status ?? '',
    })),
    trade_invoices: (tradeInvoicesResult.data ?? []).map((i) => ({ status: i.status ?? '' })),
    outbound_invoices: (outboundInvoicesResult.data ?? []).map((i) => ({ status: i.status ?? '' })),
    open_loops: [] as OpenLoop[],
  }
}
