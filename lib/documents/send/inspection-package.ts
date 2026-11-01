import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { PrintDataContext } from '@/lib/documents/print-data'
import { recordReportsLocked } from '@/lib/reports/learning'
import { DocumentSendError, type PreparedDocument, type StatusChange } from '@/lib/documents/send/documents'

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
