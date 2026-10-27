import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { buildInvoicePdf } from '@/lib/documents/invoice-pdf'
import { createExcessInvoiceDraft, deleteDraftInvoice, markInvoiceSent } from '@/lib/invoices/excess-invoice'
import {
  decisionForChoice,
  type ExcessChoice,
  type ExcessContext,
  type ExcessDecision,
  type ExcessInvoiceSummary,
} from './decision'

// Server side of the job excess decision, and the excess invoice that can go
// out with a signing request. See lib/excess/decision.ts for the model.

type Service = SupabaseClient<Database>
type Invoice = Database['public']['Tables']['invoices']['Row']

export class ExcessError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 | 500) {
    super(message)
    this.name = 'ExcessError'
  }
}

function toSummary(inv: Invoice): ExcessInvoiceSummary {
  return {
    id: inv.id,
    ref: inv.invoice_ref,
    amountIncGst: Number(inv.amount_inc_gst ?? 0),
    status: inv.status,
    issuedDate: inv.issued_date,
    paidDate: inv.paid_date,
  }
}

export async function loadExcessInvoices(service: Service, tenantId: string, jobId: string): Promise<Invoice[]> {
  const { data } = await service
    .from('invoices')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('job_id', jobId)
    .eq('invoice_type', 'excess')
    .neq('status', 'voided')
    .order('created_at', { ascending: false })
  return data ?? []
}

export async function loadExcessContext(service: Service, tenantId: string, jobId: string): Promise<ExcessContext> {
  const { data: job } = await service
    .from('jobs')
    .select('job_type, excess, excess_decision, excess_decision_note, excess_decided_at, excess_decided_by')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!job) throw new ExcessError('Job not found', 404)

  const [invoices, decidedBy] = await Promise.all([
    loadExcessInvoices(service, tenantId, jobId),
    job.excess_decided_by
      ? service.from('users').select('name').eq('id', job.excess_decided_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  return {
    applies: (job.job_type ?? 'insurance') !== 'private',
    amount: job.excess != null ? Number(job.excess) : null,
    decision: (job.excess_decision as ExcessDecision | null) ?? null,
    note: job.excess_decision_note,
    decidedAt: job.excess_decided_at,
    decidedByName: (decidedBy.data as { name: string } | null)?.name ?? null,
    invoices: invoices.map(toSummary),
  }
}

/** Records the office's excess decision on the job (and the amount, if given). */
export async function recordExcessDecision(service: Service, params: {
  tenantId: string
  jobId: string
  userId: string | null
  decision: ExcessDecision
  note?: string | null
  amountIncGst?: number | null
}): Promise<void> {
  const update: Database['public']['Tables']['jobs']['Update'] = {
    excess_decision: params.decision,
    excess_decision_note: params.note?.trim() || null,
    excess_decided_at: new Date().toISOString(),
    excess_decided_by: params.userId,
  }
  if (params.amountIncGst != null) update.excess = params.amountIncGst
  const { error } = await service.from('jobs').update(update).eq('id', params.jobId).eq('tenant_id', params.tenantId)
  if (error) throw new ExcessError(`Could not save the excess decision: ${error.message}`, 500)
}

// ── Excess with a send ──────────────────────────────────────────────────────

export interface PreparedExcess {
  choice: ExcessChoice
  decision: ExcessDecision
  /** The invoice to attach (null if none) */
  invoice: Invoice | null
  /** True when this send created the invoice (removed again if the send fails) */
  createdDraft: boolean
  /** PDF of the invoice to attach */
  attachment: { filename: string; pdf: Buffer } | null
}

/**
 * Before the email goes: works out the invoice to attach (creating a draft
 * excess invoice if asked) and renders its PDF. Nothing is marked sent here.
 */
export async function prepareExcessForSend(service: Service, params: {
  tenantId: string
  jobId: string
  choice: ExcessChoice
}): Promise<PreparedExcess> {
  const { tenantId, jobId, choice } = params
  const decision = decisionForChoice(choice)
  const existing = await loadExcessInvoices(service, tenantId, jobId)

  let invoice: Invoice | null = null
  let createdDraft = false
  if (choice.kind === 'new_invoice') {
    if (existing.length > 0) {
      throw new ExcessError(`An excess invoice (${existing[0].invoice_ref ?? 'draft'}) already exists on this job. Attach that one instead.`, 409)
    }
    try {
      invoice = await createExcessInvoiceDraft(service, { tenantId, jobId, amountIncGst: choice.amountIncGst })
    } catch (err) {
      throw new ExcessError(err instanceof Error ? err.message : 'Could not create the excess invoice', 500)
    }
    createdDraft = true
  } else if (choice.kind === 'attach_existing') {
    invoice = existing.find(i => i.id === choice.invoiceId) ?? null
    if (!invoice) throw new ExcessError('That excess invoice was not found on this job', 404)
  }

  let attachment: PreparedExcess['attachment'] = null
  if (invoice) {
    try {
      const { pdf, filename } = await buildInvoicePdf(invoice.id, { supabase: service, tenantId })
      attachment = { pdf, filename }
    } catch (err) {
      if (createdDraft) await deleteDraftInvoice(service, tenantId, invoice.id)
      console.error('[excess] invoice PDF failed:', err)
      throw new ExcessError('The excess invoice PDF could not be created. Nothing was sent.', 500)
    }
  }

  return { choice, decision, invoice, createdDraft, attachment }
}

/** After the email has gone: mark the invoice sent (→ accounting) and record the decision. */
export async function finaliseExcessAfterSend(service: Service, params: {
  tenantId: string
  jobId: string
  userId: string | null
  prepared: PreparedExcess
}): Promise<void> {
  const { tenantId, jobId, userId, prepared } = params
  if (prepared.invoice) await markInvoiceSent(service, tenantId, prepared.invoice.id)
  await recordExcessDecision(service, {
    tenantId,
    jobId,
    userId,
    decision: prepared.decision,
    note: prepared.choice.kind === 'not_collecting' ? prepared.choice.note : null,
    amountIncGst: prepared.choice.kind === 'new_invoice' ? prepared.choice.amountIncGst : null,
  })
}

/** The email failed: remove an invoice this send created. */
export async function abortExcessAfterFailedSend(service: Service, tenantId: string, prepared: PreparedExcess): Promise<void> {
  if (prepared.createdDraft && prepared.invoice) await deleteDraftInvoice(service, tenantId, prepared.invoice.id)
}

export { excessDueText } from './decision'
