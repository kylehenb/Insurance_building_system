import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { PrintDataContext } from '@/lib/documents/print-data'
import { recordReportsLocked } from '@/lib/reports/learning'
import { DocumentSendError, type DocumentRef, type PreparedDocument, type StatusChange } from '@/lib/documents/send/documents'

// An inspection's package (its report, quote and invoice) sent to the insurer
// from the Inspections tab's "Compile & Submit Package". The documents are
// marked sent and locked like any other send (markDocumentSent); this moves
// the inspection itself to Sent and Locked, and lets the learning module
// see how the AI's report drafts fared (tech spec §24.4).

export const INSPECTION_SENT_STATUS = 'sent_and_locked'

export interface PackageInspection {
  id: string
  inspection_ref: string | null
  status: string | null
}

export interface InspectionPackage {
  inspection: PackageInspection & { job_id: string }
  /** The core report first (it picks the email template and recipients), then the quote, the invoice, extra reports and their invoices */
  documents: DocumentRef[]
}

/**
 * The documents that make up an inspection's package — what Compile &
 * Submit Package (and the voice connector's send_inspection_package) sends.
 * The core report is inspection.report_id (else its BAR), the core quote
 * inspection.quote_id (else its inspection quote), the core invoice the
 * outbound invoice on the core report. Throws when there is no report or quote yet.
 */
export async function inspectionPackage(ctx: PrintDataContext, inspectionId: string): Promise<InspectionPackage> {
  const { supabase: db, tenantId } = ctx
  const { data: inspection } = await db.from('inspections').select('id, inspection_ref, status, job_id, report_id, quote_id')
    .eq('id', inspectionId).eq('tenant_id', tenantId).maybeSingle()
  if (!inspection?.job_id) throw new DocumentSendError('Inspection not found', 404)

  const [reports, quotes] = await Promise.all([
    db.from('reports').select('id, report_type, deleted_at, created_at')
      .eq('tenant_id', tenantId).eq('inspection_id', inspection.id).order('created_at', { ascending: true }),
    db.from('quotes').select('id, quote_type, created_at')
      .eq('tenant_id', tenantId).eq('inspection_id', inspection.id).order('created_at', { ascending: true }),
  ])
  const linkedReports = (reports.data ?? []).filter(r => !r.deleted_at)
  const coreReportId = inspection.report_id ?? linkedReports.find(r => r.report_type === 'BAR')?.id ?? null
  const coreQuoteId = inspection.quote_id ?? (quotes.data ?? []).find(q => q.quote_type === 'inspection')?.id ?? null
  if (!coreReportId || !coreQuoteId) {
    throw new DocumentSendError('Create the report and the quote for this inspection before sending the package.', 422)
  }

  const extraReportIds = linkedReports.filter(r => r.id !== coreReportId).map(r => r.id)
  const { data: invoices } = await db.from('invoices').select('id, report_id, status, created_at')
    .eq('tenant_id', tenantId).eq('direction', 'outbound').in('report_id', [coreReportId, ...extraReportIds])
    .order('created_at', { ascending: true })
  const live = (invoices ?? []).filter(i => i.status !== 'voided')
  const coreInvoice = live.find(i => i.report_id === coreReportId)

  return {
    inspection: { id: inspection.id, inspection_ref: inspection.inspection_ref, status: inspection.status, job_id: inspection.job_id },
    documents: [
      { kind: 'report', id: coreReportId },
      { kind: 'quote', id: coreQuoteId },
      ...(coreInvoice ? [{ kind: 'invoice' as const, id: coreInvoice.id }] : []),
      ...extraReportIds.map(id => ({ kind: 'report' as const, id })),
      ...live.filter(i => i.report_id !== coreReportId).map(i => ({ kind: 'invoice' as const, id: i.id })),
    ],
  }
}

/** The inspection, checked against the job the documents belong to. Throws before anything is sent. */
export async function inspectionForPackage(ctx: PrintDataContext, inspectionId: string, jobId: string): Promise<PackageInspection> {
  const { data } = await ctx.supabase.from('inspections').select('id, inspection_ref, status, job_id')
    .eq('id', inspectionId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (!data) throw new DocumentSendError('Inspection not found', 404)
  if (data.job_id !== jobId) throw new DocumentSendError('The documents belong to a different job from the inspection', 400)
  return { id: data.id, inspection_ref: data.inspection_ref, status: data.status }
}

/** Never throws: the email has already gone. */
export async function markInspectionPackageSent(
  service: SupabaseClient<Database>,
  ctx: PrintDataContext & { actorId: string | null },
  inspection: PackageInspection,
  docs: PreparedDocument[],
): Promise<StatusChange | null> {
  const reportIds = docs.filter(d => d.ref.kind === 'report').map(d => d.ref.id)
  if (reportIds.length) {
    after(() => recordReportsLocked(service as unknown as SupabaseClient, ctx.tenantId, reportIds, ctx.actorId))
  }
  if (inspection.status === INSPECTION_SENT_STATUS) return null
  const { error } = await service.from('inspections').update({ status: INSPECTION_SENT_STATUS })
    .eq('id', inspection.id).eq('tenant_id', ctx.tenantId)
  if (error) {
    console.error(`[document-send] inspection ${inspection.id} status update failed:`, error)
    return null
  }
  return {
    ref: docs[0].ref,
    description: `Inspection${inspection.inspection_ref ? ` ${inspection.inspection_ref}` : ''} marked Sent and Locked`,
  }
}
