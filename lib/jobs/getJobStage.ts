import type { OpenLoop } from './openLoops'

export type JobStageKey =
  | 'order_received'
  | 'awaiting_schedule'
  | 'inspection_scheduled'
  | 'awaiting_compilation'
  | 'sent_awaiting_approval'
  | 'declined_close_out'
  | 'approved_awaiting_signoff'
  | 'awaiting_signed_document'
  | 'signed_build_schedule'
  | 'repairs_in_progress'
  | 'awaiting_completion_signoff'
  | 'awaiting_trade_invoices'
  | 'ready_to_invoice'
  | 'invoiced_awaiting_payment'
  | 'complete'
  | 'on_hold'
  | 'cancelled'

export type JobContext = {
  job: {
    id: string
    override_stage: 'on_hold' | 'cancelled' | null
    homeowner_signoff_sent_at: string | null
    homeowner_signoff_received_at: string | null
    completion_approved_at: string | null
  }
  insurer_orders: Array<{ status: string }>
  inspection: {
    status: string
    form_submitted_at: string | null
    no_show_count: number
    last_no_show_at: string | null
  } | null
  primary_quote: {
    status: string
  } | null
  primary_report: {
    status: string
  } | null
  blueprint: {
    status: string
  } | null
  work_order_visits: Array<{ status: string }>
  trade_invoices: Array<{ status: string }>
  outbound_invoices: Array<{ status: string }>
  open_loops: OpenLoop[]
}

export type JobStage = {
  key: JobStageKey
  label: string
  description: string
  primaryAction: {
    label: string
    actionKey: string
  } | null
  isWaiting: boolean
  isBranch: boolean
  contextualWarning?: {
    message: string
    severity: 'warning' | 'info'
  }
  openLoops: OpenLoop[]
}

const STAGE_META: Record<
  JobStageKey,
  {
    label: string
    description: string
    primaryAction: { label: string; actionKey: string } | null
    isWaiting: boolean
    isBranch: boolean
  }
> = {
  order_received: {
    label: 'Order Received',
    description: 'Review the insurer order and lodge as a job',
    primaryAction: { label: 'Review & Lodge', actionKey: 'review_lodge' },
    isWaiting: false,
    isBranch: false,
  },
  awaiting_schedule: {
    label: 'Awaiting Schedule',
    description: 'Schedule the inspection with the insured',
    primaryAction: { label: 'Schedule Inspection', actionKey: 'schedule_inspection' },
    isWaiting: false,
    isBranch: false,
  },
  inspection_scheduled: {
    label: 'Inspection Scheduled',
    description: 'Waiting for the inspection date',
    primaryAction: null,
    isWaiting: true,
    isBranch: false,
  },
  awaiting_compilation: {
    label: 'Awaiting Compilation',
    description: 'Compile report, scope, and supporting documents to send',
    primaryAction: { label: 'Compile & Send', actionKey: 'compile_send' },
    isWaiting: false,
    isBranch: false,
  },
  sent_awaiting_approval: {
    label: 'Sent — Awaiting Approval',
    description: 'Waiting for insurer decision',
    primaryAction: null,
    isWaiting: true,
    isBranch: false,
  },
  declined_close_out: {
    label: 'Declined — Close Out',
    description: 'Claim declined. Tie up all loose ends before closing',
    primaryAction: { label: 'Close Out Job', actionKey: 'close_out' },
    isWaiting: false,
    isBranch: true,
  },
  approved_awaiting_signoff: {
    label: 'Approved — Awaiting Sign-Off',
    description: 'Send scope of works or building contract to homeowner for signature',
    primaryAction: { label: 'Send for Signature', actionKey: 'send_for_signature' },
    isWaiting: false,
    isBranch: false,
  },
  awaiting_signed_document: {
    label: 'Awaiting Signed Document',
    description: 'Waiting for homeowner to return signed document',
    primaryAction: null,
    isWaiting: true,
    isBranch: false,
  },
  signed_build_schedule: {
    label: 'Signed — Build Schedule',
    description: 'Homeowner signed. Build the repair schedule and issue work orders',
    primaryAction: { label: 'Build Schedule', actionKey: 'build_schedule' },
    isWaiting: false,
    isBranch: false,
  },
  repairs_in_progress: {
    label: 'Repairs In Progress',
    description: 'Trades are on site. Gary is managing coordination',
    primaryAction: null,
    isWaiting: true,
    isBranch: false,
  },
  awaiting_completion_signoff: {
    label: 'Awaiting Completion Sign-Off',
    description: 'Repairs complete. Record homeowner confirmation',
    primaryAction: { label: 'Record Sign-Off', actionKey: 'record_signoff' },
    isWaiting: false,
    isBranch: false,
  },
  awaiting_trade_invoices: {
    label: 'Awaiting Trade Invoices',
    description: 'Collect all trade invoices before invoicing the insurer',
    primaryAction: { label: 'Review Trade Invoices', actionKey: 'review_trade_invoices' },
    isWaiting: false,
    isBranch: false,
  },
  ready_to_invoice: {
    label: 'Ready to Invoice',
    description: 'All trade invoices received. Create the IRC invoice',
    primaryAction: { label: 'Create Invoice', actionKey: 'create_invoice' },
    isWaiting: false,
    isBranch: false,
  },
  invoiced_awaiting_payment: {
    label: 'Invoiced — Awaiting Payment',
    description: 'Invoice sent. Waiting for payment confirmation from Xero',
    primaryAction: null,
    isWaiting: true,
    isBranch: false,
  },
  complete: {
    label: 'Complete',
    description: 'Job closed',
    primaryAction: null,
    isWaiting: false,
    isBranch: true,
  },
  on_hold: {
    label: 'On Hold',
    description: 'Job paused',
    primaryAction: null,
    isWaiting: false,
    isBranch: false,
  },
  cancelled: {
    label: 'Cancelled',
    description: 'Job cancelled',
    primaryAction: null,
    isWaiting: false,
    isBranch: true,
  },
}

function buildStage(
  key: JobStageKey,
  openLoops: OpenLoop[],
  contextualWarning?: JobStage['contextualWarning']
): JobStage {
  const meta = STAGE_META[key]
  return {
    key,
    label: meta.label,
    description: meta.description,
    primaryAction: meta.primaryAction,
    isWaiting: meta.isWaiting,
    isBranch: meta.isBranch,
    contextualWarning,
    openLoops,
  }
}

export function getJobStage(context: JobContext): JobStage {
  const { job, insurer_orders, inspection, primary_quote, primary_report, blueprint,
    work_order_visits, trade_invoices, outbound_invoices, open_loops } = context

  // 1. on_hold
  if (job.override_stage === 'on_hold') {
    return buildStage('on_hold', open_loops)
  }

  // 2. cancelled
  if (job.override_stage === 'cancelled') {
    return buildStage('cancelled', open_loops)
  }

  // 3. order_received — pending insurer order, not yet lodged
  if (insurer_orders.some((o) => o.status === 'pending')) {
    return buildStage('order_received', open_loops)
  }

  // 4. awaiting_schedule — no inspection or unscheduled
  const unscheduledStatuses = ['unscheduled', 'proposed', 'awaiting_reschedule']
  if (inspection === null || unscheduledStatuses.includes(inspection.status)) {
    let warning: JobStage['contextualWarning']
    if (inspection !== null && inspection.no_show_count > 0) {
      warning = {
        message: `Previous no-show on ${inspection.last_no_show_at} — confirm access before booking`,
        severity: 'warning',
      }
    }
    return buildStage('awaiting_schedule', open_loops, warning)
  }

  // 5. inspection_scheduled
  if (inspection.status === 'confirmed') {
    return buildStage('inspection_scheduled', open_loops)
  }

  // 6. awaiting_compilation — inspection submitted, quote draft or missing
  if (
    inspection.form_submitted_at !== null &&
    (primary_quote === null || primary_quote.status === 'draft')
  ) {
    return buildStage('awaiting_compilation', open_loops)
  }

  // 7. sent_awaiting_approval — both sent
  if (
    primary_quote !== null &&
    primary_quote.status === 'sent' &&
    primary_report !== null &&
    primary_report.status === 'sent'
  ) {
    return buildStage('sent_awaiting_approval', open_loops)
  }

  // 8. declined_close_out
  if (primary_quote !== null && primary_quote.status === 'rejected') {
    return buildStage('declined_close_out', open_loops)
  }

  // 9. approved_awaiting_signoff — approved, signoff not yet sent
  if (
    primary_quote !== null &&
    primary_quote.status === 'approved' &&
    job.homeowner_signoff_sent_at === null
  ) {
    return buildStage('approved_awaiting_signoff', open_loops)
  }

  // 10. awaiting_signed_document — signoff sent, not yet received
  if (
    job.homeowner_signoff_sent_at !== null &&
    job.homeowner_signoff_received_at === null
  ) {
    return buildStage('awaiting_signed_document', open_loops)
  }

  // 11. signed_build_schedule — signoff received, no confirmed blueprint
  if (
    job.homeowner_signoff_received_at !== null &&
    (blueprint === null || blueprint.status === 'draft')
  ) {
    return buildStage('signed_build_schedule', open_loops)
  }

  // 12. repairs_in_progress — blueprint confirmed, some visits not complete
  if (
    blueprint !== null &&
    blueprint.status === 'confirmed' &&
    work_order_visits.some((v) => v.status !== 'complete')
  ) {
    return buildStage('repairs_in_progress', open_loops)
  }

  // 13. awaiting_completion_signoff — all visits complete, no approval
  if (
    work_order_visits.length > 0 &&
    work_order_visits.every((v) => v.status === 'complete') &&
    job.completion_approved_at === null
  ) {
    return buildStage('awaiting_completion_signoff', open_loops)
  }

  // 14. awaiting_trade_invoices — completion approved, invoices not all approved
  if (
    job.completion_approved_at !== null &&
    (trade_invoices.length === 0 || trade_invoices.some((i) => i.status !== 'approved'))
  ) {
    return buildStage('awaiting_trade_invoices', open_loops)
  }

  // 15. ready_to_invoice — all trade invoices approved, no outbound yet
  if (
    trade_invoices.length > 0 &&
    trade_invoices.every((i) => i.status === 'approved') &&
    outbound_invoices.length === 0
  ) {
    return buildStage('ready_to_invoice', open_loops)
  }

  // 16. invoiced_awaiting_payment — outbound invoice exists, none paid
  if (outbound_invoices.length > 0 && !outbound_invoices.some((i) => i.status === 'paid')) {
    return buildStage('invoiced_awaiting_payment', open_loops)
  }

  // 17. complete — at least one outbound invoice paid
  if (outbound_invoices.some((i) => i.status === 'paid')) {
    return buildStage('complete', open_loops)
  }

  // Fallback
  return buildStage('awaiting_compilation', open_loops)
}
