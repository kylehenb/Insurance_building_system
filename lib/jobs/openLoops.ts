export type OpenLoopType =
  | 'make_safe_required'
  | 'specialist_report_required'
  | 'trade_quote_required'
  | 'restoration_engaged'
  | 'variation_requested'
  | 'report_revision_requested'
  | 'insurer_query'
  | 'partial_approval'
  | 'homeowner_not_responding'
  | 'missing_contact_details'
  | 'trade_unresponsive'
  | 'trade_pricing_dispute'
  | 'invoice_queried'
  | 'close_out_blocker'

export type OpenLoop = {
  type: OpenLoopType
  label: string
  urgency: 'urgent' | 'normal'
  actionKey: string
  entityId?: string
}

export const OPEN_LOOP_CONFIG: Record<
  OpenLoopType,
  { label: string; urgency: 'urgent' | 'normal'; actionKey: string }
> = {
  make_safe_required: {
    label: 'Make Safe Required',
    urgency: 'urgent',
    actionKey: 'handle_make_safe',
  },
  specialist_report_required: {
    label: 'Specialist Report Required',
    urgency: 'normal',
    actionKey: 'handle_specialist_report',
  },
  trade_quote_required: {
    label: 'Trade Quote Required',
    urgency: 'normal',
    actionKey: 'handle_trade_quote',
  },
  restoration_engaged: {
    label: 'Waiting on Restoration',
    urgency: 'normal',
    actionKey: 'handle_restoration',
  },
  variation_requested: {
    label: 'Variation Requested',
    urgency: 'normal',
    actionKey: 'handle_variation',
  },
  report_revision_requested: {
    label: 'Report Revision Required',
    urgency: 'normal',
    actionKey: 'handle_report_revision',
  },
  insurer_query: {
    label: 'Insurer Query',
    urgency: 'normal',
    actionKey: 'handle_insurer_query',
  },
  partial_approval: {
    label: 'Partial Approval',
    urgency: 'normal',
    actionKey: 'handle_partial_approval',
  },
  homeowner_not_responding: {
    label: 'Homeowner Not Responding',
    urgency: 'normal',
    actionKey: 'handle_homeowner_comms',
  },
  missing_contact_details: {
    label: 'Missing Contact Details',
    urgency: 'urgent',
    actionKey: 'handle_missing_details',
  },
  trade_unresponsive: {
    label: 'Trade Unresponsive',
    urgency: 'normal',
    actionKey: 'handle_trade_response',
  },
  trade_pricing_dispute: {
    label: 'Trade Pricing Dispute',
    urgency: 'normal',
    actionKey: 'handle_trade_dispute',
  },
  invoice_queried: {
    label: 'Invoice Queried',
    urgency: 'normal',
    actionKey: 'handle_invoice_query',
  },
  close_out_blocker: {
    label: 'Close-Out Blocker',
    urgency: 'urgent',
    actionKey: 'handle_close_out',
  },
}
