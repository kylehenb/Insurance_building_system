// Where a requested service is up to and what it needs next (lib/jobs/services.ts),
// from the service and its work order, report and invoice. Client-safe:
// the job page, the dashboard list and the voice connector all show this.

export type ServiceStatus = 'unassigned' | 'in_house' | 'trade' | 'done' | 'cancelled'

export interface ServiceFacts {
  service: { id: string; job_id: string; service_type: string; status: string; work_order_id: string | null; report_id: string | null; invoice_id: string | null; notes: string | null; created_at: string }
  workOrder: { id: string; status: string | null; garyState: string | null; tradeName: string | null } | null
  report: { id: string; ref: string | null; status: string | null } | null
  invoice: { id: string; ref: string | null; status: string | null } | null
}

export type ServiceStageKey =
  | 'unassigned' | 'wo_unsent' | 'with_trade' | 'trade_done'
  | 'no_invoice' | 'to_send' | 'invoice_outstanding' | 'done' | 'cancelled'

export interface ServiceStage {
  key: ServiceStageKey
  /** What it needs next, for the office */
  text: string
  /** A make safe nobody's doing yet */
  urgent: boolean
  open: boolean
}

const reportSent = (r: ServiceFacts['report']) => r?.status === 'sent'
const invoiceSent = (i: ServiceFacts['invoice']) => !!i && i.status !== 'draft' && i.status !== 'voided'
const workOrderSent = (w: NonNullable<ServiceFacts['workOrder']>) => !((w.status ?? 'pending') === 'pending' && (w.garyState ?? 'not_started') === 'not_started')
const tradeDone = (w: NonNullable<ServiceFacts['workOrder']>) => w.status === 'works_complete' || w.status === 'invoice_received' || w.garyState === 'complete'

export function serviceStage(f: ServiceFacts): ServiceStage {
  const makeSafe = f.service.service_type === 'make_safe'
  const s = (key: ServiceStageKey, text: string, urgent = false): ServiceStage => ({ key, text, urgent, open: key !== 'done' && key !== 'cancelled' })

  if (f.service.status === 'cancelled') return s('cancelled', `Not needed${f.service.notes ? ` — ${f.service.notes}` : ''}`)
  if (f.service.status === 'done') return s('done', 'Report and invoice sent')
  if (f.service.status === 'unassigned') return s('unassigned', 'Not yet arranged — do it in-house or send it to a trade', makeSafe)

  // Arranged: the report and invoice decide the rest
  const invoice = f.invoice && f.invoice.status !== 'voided' ? f.invoice : null
  if (f.report) {
    if (reportSent(f.report) && invoiceSent(invoice)) return s('done', 'Report and invoice sent')
    if (reportSent(f.report)) return s('invoice_outstanding', invoice ? `Report sent — invoice ${invoice.ref ?? ''} still to send`.replace(/\s+/g, ' ') : 'Report sent — no invoice yet, raise and send it')
    if (!invoice) return s('no_invoice', `Report ${f.report.ref ?? ''} has no invoice yet — raise it on the Invoices tab`.replace(/\s+/g, ' '))
    return s('to_send', `Report ${f.report.ref ?? ''} and invoice ${invoice.ref ?? ''} to finish and send`.replace(/\s+/g, ' '))
  }
  if (f.service.status === 'trade') {
    if (!f.workOrder) return s('wo_unsent', 'With a trade, but its work order is gone — send it to a trade again or do it in-house', makeSafe)
    if (tradeDone(f.workOrder)) return s('trade_done', `${f.workOrder.tradeName ?? 'The trade'} is done — prepare the report and invoice (their cost plus margin)`)
    if (!workOrderSent(f.workOrder)) return s('wo_unsent', `Work order not sent yet${f.workOrder.tradeName ? ` (${f.workOrder.tradeName})` : ' — pick the contractor'}`, makeSafe)
    return s('with_trade', `With ${f.workOrder.tradeName ?? 'the trade'}`)
  }
  return s('no_invoice', 'Being done in-house — the report is missing, do it in-house again to recreate it')
}

/** One line for lists and voice: "Make Safe — not yet arranged" */
export function describeService(label: string, stage: ServiceStage): string {
  return `${label}: ${stage.text}${stage.urgent ? ' (urgent)' : ''}`
}
