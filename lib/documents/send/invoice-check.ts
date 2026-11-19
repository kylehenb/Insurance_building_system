import type { PrintDataContext } from '@/lib/documents/print-data'
import { DocumentSendError, type PreparedDocument } from '@/lib/documents/send/documents'

// Reports go to the insurer with their invoice, so the invoice is never
// missed. Sending a report (or marking it sent) without it stops with what's
// missing; it can still go with a reason (sendWithoutInvoice), which needs
// the "Send a report without its invoice" permission and is noted on the job.
// A report whose invoice already went earlier is fine on its own (a revised
// report, say). Used by every send: the Send button, the voice connector and
// the action cards (lib/documents/send/email.ts).

export interface MissingInvoice {
  reportId: string
  /** e.g. "Make Safe Report MS-IRC1042-1" */
  title: string
  /** 'none': the report has no invoice; 'not_attached': it has one that hasn't gone and isn't in this email */
  reason: 'none' | 'not_attached'
  invoiceId: string | null
  invoiceRef: string | null
}

export interface SendWithoutInvoice {
  /** Why it's going without its invoice — noted on the job */
  reason: string
}

export function describeMissingInvoice(m: MissingInvoice): string {
  return m.reason === 'none'
    ? `${m.title} has no invoice yet`
    : `${m.title}'s invoice ${m.invoiceRef ?? ''} isn't attached`.replace(/\s+/g, ' ')
}

export function missingInvoicesMessage(missing: MissingInvoice[]): string {
  return `${missing.map(describeMissingInvoice).join('. ')}. Reports go to the insurer with their invoice — attach it, or send anyway with a reason.`
}

export class ReportWithoutInvoiceError extends DocumentSendError {
  readonly code = 'report_without_invoice'
  constructor(public readonly missing: MissingInvoice[]) {
    super(missingInvoicesMessage(missing), 409)
    this.name = 'ReportWithoutInvoiceError'
  }
}

/** The reports in this email to the insurer that would go without their invoice */
export async function reportsMissingInvoices(ctx: PrintDataContext, docs: PreparedDocument[]): Promise<MissingInvoice[]> {
  const reports = docs.filter(d => d.ref.kind === 'report' && d.audience === 'insurer')
  if (!reports.length) return []
  const attached = new Set(docs.filter(d => d.ref.kind === 'invoice').map(d => d.ref.id))
  const { data, error } = await ctx.supabase
    .from('invoices').select('id, report_id, invoice_ref, status, direction')
    .eq('tenant_id', ctx.tenantId).in('report_id', reports.map(r => r.ref.id))
  if (error) throw error
  const invoices = ((data ?? []) as { id: string; report_id: string | null; invoice_ref: string | null; status: string | null; direction: string | null }[])
    .filter(i => i.status !== 'voided' && (i.direction ?? 'outbound') === 'outbound')

  const missing: MissingInvoice[] = []
  for (const report of reports) {
    const own = invoices.filter(i => i.report_id === report.ref.id)
    // Attached here, or already sent before
    if (own.some(i => attached.has(i.id) || (i.status ?? 'draft') !== 'draft')) continue
    missing.push({
      reportId: report.ref.id,
      title: report.title,
      reason: own.length ? 'not_attached' : 'none',
      invoiceId: own[0]?.id ?? null,
      invoiceRef: own[0]?.invoice_ref ?? null,
    })
  }
  return missing
}

/** A reason for sending without the invoice, from a request body — null when none was given */
export function parseSendWithoutInvoice(value: unknown): SendWithoutInvoice | null {
  if (value === undefined || value === null || value === false) return null
  const reason = typeof value === 'object' && typeof (value as { reason?: unknown }).reason === 'string'
    ? (value as { reason: string }).reason.trim()
    : typeof value === 'string' ? value.trim() : ''
  if (reason.length < 3) throw new DocumentSendError('Say why the report is going without its invoice', 400)
  return { reason: reason.slice(0, 500) }
}
