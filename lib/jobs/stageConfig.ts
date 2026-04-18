import type { JobStageKey } from './getJobStage'

export const STAGE_CONFIG: Record<
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
