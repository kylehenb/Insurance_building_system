import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { createInvoiceForReport } from '@/lib/invoices/report-to-invoice'

// Creating a report on a job (with its invoice, as New report on the Reports
// tab does), changing its fields while it's unlocked, and locking it. Works
// with the browser client (the Reports tab) or the service client (the
// reports route, the voice connector). The caller checks jobs.edit.

type Client = SupabaseClient<Database>
export type Report = Database['public']['Tables']['reports']['Row']
type ReportUpdate = Database['public']['Tables']['reports']['Update']

export class ReportEditError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ReportEditError'
  }
}

/** The types New report offers */
export const NEW_REPORT_TYPES = ['BAR', 'make_safe', 'roof', 'specialist', 'LDR'] as const
export type NewReportType = typeof NEW_REPORT_TYPES[number]

export const REPORT_TYPE_LABELS: Record<string, string> = {
  BAR: 'BAR', storm_wind: 'Storm / wind', make_safe: 'Make Safe', roof: 'Roof Report', specialist: 'Specialist Report', LDR: 'Leak Detection Report',
}

/** Report reference prefixes by type */
export const REPORT_TYPE_PREFIXES: Record<string, string> = {
  BAR: 'BAR', storm_wind: 'SW', make_safe: 'MS', roof: 'RR', specialist: 'SPR', LDR: 'LDR',
}

/** The written fields of a report (what the report forms edit) */
export const REPORT_TEXT_FIELDS = [
  'attendance_date', 'attendance_time', 'person_met', 'assessor_name', 'property_address', 'insured_name', 'claim_number',
  'loss_type', 'property_description', 'incident_description', 'cause_of_damage', 'how_damage_occurred', 'resulting_damage',
  'conclusion', 'pre_existing_conditions', 'maintenance_notes', 'raw_report_notes', 'damage_template', 'additional_notes',
] as const satisfies readonly (keyof ReportUpdate)[]
export type ReportTextField = typeof REPORT_TEXT_FIELDS[number]

/**
 * A new draft report on a job, with the report's invoice raised at the
 * insurer's price (a failed invoice is logged, not fatal — as on the tab).
 */
export async function createReport(
  supabase: Client,
  tenantId: string,
  input: { jobId: string; type: NewReportType },
): Promise<{ report: Report; invoiceRef: string | null }> {
  if (!NEW_REPORT_TYPES.includes(input.type)) throw new ReportEditError(`Report type must be one of ${NEW_REPORT_TYPES.join(', ')}`, 400)
  const { data: job } = await supabase
    .from('jobs').select('job_number, property_details, property_address, claim_number')
    .eq('id', input.jobId).eq('tenant_id', tenantId).maybeSingle()
  if (!job) throw new ReportEditError('Job not found', 404)

  const { count } = await supabase
    .from('reports').select('id', { count: 'exact', head: true }).eq('job_id', input.jobId).eq('tenant_id', tenantId)
  const jobNumber = job.job_number ?? 'UNKNOWN'
  const reportRef = `${REPORT_TYPE_PREFIXES[input.type] || 'RPT'}-${jobNumber}-${(count ?? 0) + 1}`

  const { data: report, error } = await supabase
    .from('reports')
    .insert({
      tenant_id: tenantId, job_id: input.jobId, report_ref: reportRef, report_type: input.type,
      status: 'draft', is_locked: false, version: 1, type_specific_fields: {},
    })
    .select().single()
  if (error || !report) throw new ReportEditError(error?.message ?? 'Could not create the report', 500)

  // Property type from the job's storeys, for roof report pricing
  const storeys = (job.property_details as Record<string, unknown> | null)?.storeys as string | null | undefined
  const propertyType = storeys === '2' || storeys === 'double' ? 'double_storey' : storeys === '1' || storeys === 'single' ? 'single_storey' : null

  let invoiceRef: string | null = null
  try {
    const invoice = await createInvoiceForReport(supabase, {
      tenantId, jobId: input.jobId, reportId: report.id, inspectionId: null, reportType: input.type, propertyType,
      propertyAddress: job.property_address || null, claimNumber: job.claim_number || null, jobNumber,
    })
    invoiceRef = invoice?.invoiceRef ?? null
    if (!invoice) console.warn('[reports] failed to auto-create invoice for report', report.id)
  } catch (err) {
    console.error('[reports] error creating invoice:', err)
  }
  return { report, invoiceRef }
}

/** Why a report can't be edited, or null if it can. The forms are read-only once it's locked. */
export function reportLockedReason(report: Pick<Report, 'is_locked' | 'deleted_at' | 'report_ref'>): string | null {
  if (report.deleted_at) return `${report.report_ref ?? 'This report'} has been deleted.`
  if (report.is_locked) return `${report.report_ref ?? 'This report'} is locked — unlock it first to change it.`
  return null
}

async function loadReport(supabase: Client, tenantId: string, reportId: string): Promise<Report> {
  const { data, error } = await supabase.from('reports').select('*').eq('id', reportId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw new ReportEditError(error.message, 500)
  if (!data) throw new ReportEditError('Report not found', 404)
  return data
}

/**
 * Changes an unlocked report's written fields; type_specific_fields is merged
 * into what's there (the per-type form fields). Other keys are ignored.
 */
export async function updateReport(
  supabase: Client,
  tenantId: string,
  reportId: string,
  fields: Partial<Record<ReportTextField, string | null>> & { type_specific_fields?: Record<string, unknown> },
): Promise<Report> {
  const report = await loadReport(supabase, tenantId, reportId)
  const locked = reportLockedReason(report)
  if (locked) throw new ReportEditError(locked, 409)

  const patch: ReportUpdate = {}
  for (const k of REPORT_TEXT_FIELDS) if (k in fields) (patch as Record<string, unknown>)[k] = fields[k]
  if (fields.type_specific_fields && typeof fields.type_specific_fields === 'object') {
    const current = report.type_specific_fields && typeof report.type_specific_fields === 'object' && !Array.isArray(report.type_specific_fields)
      ? report.type_specific_fields as Record<string, Json> : {}
    patch.type_specific_fields = { ...current, ...fields.type_specific_fields } as Json
  }
  if (!Object.keys(patch).length) return report

  const { data, error } = await supabase.from('reports').update(patch).eq('id', reportId).eq('tenant_id', tenantId).select('*').single()
  if (error || !data) throw new ReportEditError(error?.message ?? 'Update failed', 500)
  return data
}

/**
 * Locks (finished — the similar-report fingerprint follows, see the reports
 * route and the index-embeddings cron) or unlocks a report.
 */
export async function setReportLocked(supabase: Client, tenantId: string, reportId: string, locked: boolean): Promise<void> {
  const { error } = await supabase.from('reports').update({ is_locked: locked }).eq('id', reportId).eq('tenant_id', tenantId)
  if (error) throw new ReportEditError(error.message, 500)
}
