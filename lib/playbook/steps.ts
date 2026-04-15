/**
 * Job Playbook — Step Definitions
 *
 * This file defines every step in the job workflow from lodgement to close.
 * It is self-contained: add, remove, or reorder steps here without touching
 * any other file. The components that render the rail import from here.
 *
 * HOW TO READ EACH STEP
 * ---------------------
 *  id          — stable unique identifier, never change once in production
 *  label       — short name shown in the rail
 *  description — one sentence explaining what needs to happen
 *  category    — groups steps into workflow phases
 *  isComplete  — returns true when the step is done (reads from live job data)
 *  isVisible   — returns false to hide the step entirely (not skip, not grey)
 *  primaryAction — button the user clicks to go complete the step
 *  subTasks    — optional checklist items within the step
 *  skipAllowed — when true, a "Skip this step" link is shown
 */

// ── Status types ────────────────────────────────────────────────────────────

export type PlaybookStepStatus =
  | 'complete'
  | 'current'
  | 'upcoming'
  | 'skipped'
  | 'not_applicable'

// ── Action types ─────────────────────────────────────────────────────────────

export type PlaybookActionType =
  | 'navigate'   // navigate to a tab or page
  | 'modal'      // open a modal
  | 'inline'     // execute inline (e.g. status update via API)
  | 'compose'    // open email compose window
  | 'generate'   // trigger PDF/document generation

export interface PlaybookAction {
  label: string
  type: PlaybookActionType
  /** Route, tab name, or action key depending on type */
  target?: string
}

// ── Step interface ───────────────────────────────────────────────────────────

export interface PlaybookStep {
  id: string
  label: string
  description: string
  category:
    | 'lodge'
    | 'inspect'
    | 'report'
    | 'send'
    | 'approval'
    | 'contract'
    | 'repairs'
    | 'invoice'
    | 'close'

  /** Returns true when this step is complete */
  isComplete: (job: JobPlaybookContext) => boolean

  /** Returns false to hide the step entirely — for steps that don't apply to this job */
  isVisible: (job: JobPlaybookContext) => boolean

  /** Primary action button shown on the current step card */
  primaryAction?: PlaybookAction

  /** Optional checklist sub-tasks within this step */
  subTasks?: Array<{
    id: string
    label: string
    isComplete: (job: JobPlaybookContext) => boolean
    action?: PlaybookAction
  }>

  /** When false, the skip link is hidden entirely */
  skipAllowed: boolean
}

// ── Job context ──────────────────────────────────────────────────────────────
//
// Derived from existing Supabase queries on the job detail page.
// The playbook reads this data — it never writes to the database directly
// (only through action buttons that navigate to the relevant tabs).

export interface JobPlaybookContext {
  job: {
    id: string
    status: string
    kpi_contacted_at: string | null
    kpi_reported_at: string | null
    /** Added by migration: set when scope of works is sent to insured */
    scope_sent_at: string | null
    /** Added by migration: set when building contract is sent */
    building_contract_sent_at: string | null
    /** Added by migration: flag set when permit is required for this job */
    building_permit_required: boolean
    /** Added by migration: set when building permit is obtained */
    building_permit_obtained_at: string | null
  }
  inspections: Array<{
    id: string
    status: string | null
    report_status: string | null
    scope_status: string | null
  }>
  reports: Array<{
    id: string
    report_type: string
    status: string | null
  }>
  quotes: Array<{
    id: string
    status: string | null
    total_amount: number | null
    quote_type: string | null
    approval_notes: string | null
  }>
  workOrders: Array<{
    id: string
    status: string | null
    work_type: string | null
  }>
  workOrderVisits: Array<{
    id: string
    status: string | null
  }>
  invoices: {
    inbound: Array<{ id: string; status: string | null }>
    outbound: Array<{ id: string; status: string | null }>
  }
  blueprint: {
    exists: boolean
    status: string | null
  }
  /** True when a make-safe work order or flag is present on this job */
  hasMakeSafe: boolean
  /** True when a roof report has been requested or is present */
  hasRoofReport: boolean
  /** True when a specialist report has been requested or is present */
  hasSpecialistReport: boolean
  /** Reflects jobs.building_permit_required — convenience alias */
  buildingPermitRequired: boolean
  /** Total of the approved inspection quote, null if no approved quote yet */
  approvedQuoteTotal: number | null
}

// ── Helper predicates (keep isComplete functions readable) ───────────────────

const INSPECTION_COMPLETE_STATUSES = ['submitted', 'complete']
const INSPECTION_CONFIRMED_STATUSES = ['confirmed', 'submitted', 'complete', 'attended']
const QUOTE_COMPLETE_STATUSES = ['complete', 'approved', 'sent', 'invoiced']
const INVOICE_DONE_STATUSES = ['sent', 'paid']

// ── Step definitions ─────────────────────────────────────────────────────────

export const playbookSteps: PlaybookStep[] = [

  // ── STEP 1 ───────────────────────────────────────────────────────────────
  {
    id: 'lodge',
    label: 'Order received',
    description: 'Job created and claim lodged in the system.',
    category: 'lodge',
    isComplete: () => true, // If you can see this page the job exists
    isVisible: () => true,
    skipAllowed: false,
  },

  // ── STEP 2 ───────────────────────────────────────────────────────────────
  {
    id: 'acknowledged',
    label: 'Insured contacted',
    description: 'Acknowledgement SMS sent to insured within 2 hours.',
    category: 'lodge',
    isComplete: (ctx) => ctx.job.kpi_contacted_at !== null,
    isVisible: () => true,
    primaryAction: {
      label: 'Go to Comms',
      type: 'navigate',
      target: 'comms',
    },
    skipAllowed: true,
  },

  // ── STEP 3 ───────────────────────────────────────────────────────────────
  {
    id: 'inspection_scheduled',
    label: 'Inspection scheduled',
    description: 'Inspection date confirmed with the insured.',
    category: 'inspect',
    isComplete: (ctx) =>
      ctx.inspections.some(i => INSPECTION_CONFIRMED_STATUSES.includes(i.status ?? '')),
    isVisible: () => true,
    primaryAction: {
      label: 'Go to Calendar',
      type: 'navigate',
      target: 'calendar',
    },
    skipAllowed: false,
  },

  // ── STEP 4 ───────────────────────────────────────────────────────────────
  {
    id: 'inspection_attended',
    label: 'Inspection attended',
    description: 'Field app submitted on site.',
    category: 'inspect',
    isComplete: (ctx) =>
      ctx.inspections.some(i => INSPECTION_COMPLETE_STATUSES.includes(i.status ?? '')),
    isVisible: () => true,
    primaryAction: {
      label: 'Go to Inspections',
      type: 'navigate',
      target: 'inspections',
    },
    skipAllowed: false,
  },

  // ── STEP 5 ───────────────────────────────────────────────────────────────
  {
    id: 'make_safe_dispatched',
    label: 'Make safe dispatched',
    description: 'Trade dispatched to make property safe.',
    category: 'inspect',
    isComplete: (ctx) =>
      ctx.workOrders.some(
        wo => wo.work_type === 'make_safe' && wo.status !== 'pending' && wo.status !== null
      ),
    isVisible: (ctx) => ctx.hasMakeSafe,
    primaryAction: {
      label: 'Go to Trade Work Orders',
      type: 'navigate',
      target: 'trade-work-orders',
    },
    skipAllowed: false,
  },

  // ── STEP 6 ───────────────────────────────────────────────────────────────
  {
    id: 'make_safe_complete',
    label: 'Make safe complete',
    description: 'Make safe works finished and report completed.',
    category: 'inspect',
    isComplete: (ctx) =>
      ctx.reports.some(
        r => r.report_type === 'make_safe' && ['complete', 'sent'].includes(r.status ?? '')
      ),
    isVisible: (ctx) => ctx.hasMakeSafe,
    primaryAction: {
      label: 'Go to Reports',
      type: 'navigate',
      target: 'reports',
    },
    skipAllowed: false,
  },

  // ── STEP 7 ───────────────────────────────────────────────────────────────
  {
    id: 'report_ready',
    label: 'Report reviewed',
    description: 'BAR report reviewed and ready to send.',
    category: 'report',
    isComplete: (ctx) =>
      ctx.reports.some(
        r => r.report_type === 'BAR' && ['complete', 'sent'].includes(r.status ?? '')
      ),
    isVisible: () => true,
    primaryAction: {
      label: 'Go to Reports',
      type: 'navigate',
      target: 'reports',
    },
    skipAllowed: false,
  },

  // ── STEP 8 ───────────────────────────────────────────────────────────────
  {
    id: 'quote_ready',
    label: 'Quote reviewed',
    description: 'Scope and quote reviewed and ready to send.',
    category: 'report',
    isComplete: (ctx) =>
      ctx.quotes.some(
        q => q.quote_type === 'inspection' && QUOTE_COMPLETE_STATUSES.includes(q.status ?? '')
      ),
    isVisible: () => true,
    primaryAction: {
      label: 'Go to Quotes',
      type: 'navigate',
      target: 'quotes',
    },
    skipAllowed: false,
  },

  // ── STEP 9 ───────────────────────────────────────────────────────────────
  {
    id: 'sent_to_insurer',
    label: 'Sent to insurer',
    description: 'Report, quote and photos submitted to insurer.',
    category: 'send',
    isComplete: (ctx) =>
      ctx.reports.some(r => r.report_type === 'BAR' && r.status === 'sent'),
    isVisible: () => true,
    primaryAction: {
      label: 'Go to Inspections',
      type: 'navigate',
      target: 'inspections',
    },
    skipAllowed: false,
  },

  // ── STEP 10 ──────────────────────────────────────────────────────────────
  {
    id: 'awaiting_response',
    label: 'Awaiting insurer response',
    description: 'Waiting for insurer decision on the claim.',
    category: 'send',
    isComplete: (ctx) =>
      ctx.quotes.some(q => q.status === 'approved' || q.status === 'rejected') ||
      ctx.job.status === 'cancelled',
    isVisible: () => true,
    // Passive waiting step — no primary action button.
    // A subtle "log response manually" link is rendered by the rail component.
    primaryAction: {
      label: 'Log response manually',
      type: 'navigate',
      target: 'comms',
    },
    skipAllowed: false,
  },

  // ── STEP 11 ──────────────────────────────────────────────────────────────
  {
    id: 'claim_outcome',
    label: 'Claim accepted',
    description: 'Quote marked as approved and approval reference recorded.',
    category: 'approval',
    isComplete: (ctx) =>
      ctx.quotes.some(q => q.quote_type === 'inspection' && q.status === 'approved'),
    isVisible: () => true, // If rejected, the rail shows this as skipped/not-applicable
    primaryAction: {
      label: 'Go to Quotes',
      type: 'navigate',
      target: 'quotes',
    },
    subTasks: [
      {
        id: 'claim_outcome_mark_approved',
        label: 'Mark quote as approved',
        isComplete: (ctx) =>
          ctx.quotes.some(q => q.quote_type === 'inspection' && q.status === 'approved'),
        action: { label: 'Go to Quotes', type: 'navigate', target: 'quotes' },
      },
      {
        id: 'claim_outcome_record_ref',
        label: 'Record approval reference',
        isComplete: (ctx) =>
          ctx.quotes.some(
            q => q.quote_type === 'inspection' && q.status === 'approved' && q.approval_notes !== null
          ),
        action: { label: 'Go to Quotes', type: 'navigate', target: 'quotes' },
      },
    ],
    skipAllowed: false,
  },

  // ── STEP 12 ──────────────────────────────────────────────────────────────
  {
    id: 'scope_sent',
    label: 'Scope sent to insured',
    description: 'Signed scope of works sent to insured for signature.',
    category: 'contract',
    isComplete: (ctx) => ctx.job.scope_sent_at !== null,
    isVisible: (ctx) => ctx.approvedQuoteTotal !== null,
    primaryAction: {
      label: 'Send scope of works',
      type: 'compose',
      target: 'scope',
    },
    subTasks: [
      {
        id: 'scope_sent_generate',
        label: 'Generate scope of works document',
        isComplete: () => false, // Presence of generated doc not yet tracked — always prompts
        action: { label: 'Generate', type: 'generate', target: 'scope' },
      },
      {
        id: 'scope_sent_send',
        label: 'Send to insured for signature',
        isComplete: (ctx) => ctx.job.scope_sent_at !== null,
        action: { label: 'Compose email', type: 'compose', target: 'scope' },
      },
    ],
    skipAllowed: true,
  },

  // ── STEP 13 ──────────────────────────────────────────────────────────────
  {
    id: 'building_contract_sent',
    label: 'Building contract sent',
    description: 'Building contract sent with scope of works for insured signature.',
    category: 'contract',
    isComplete: (ctx) => ctx.job.building_contract_sent_at !== null,
    // Only required when approved quote total is $7,500 or above
    isVisible: (ctx) => (ctx.approvedQuoteTotal ?? 0) >= 7500,
    primaryAction: {
      label: 'Send building contract',
      type: 'compose',
      target: 'building_contract',
    },
    subTasks: [
      {
        id: 'building_contract_generate',
        label: 'Generate building contract',
        isComplete: () => false, // Presence of generated doc not yet tracked — always prompts
        action: { label: 'Generate', type: 'generate', target: 'building_contract' },
      },
      {
        id: 'building_contract_send',
        label: 'Send to insured for signature',
        isComplete: (ctx) => ctx.job.building_contract_sent_at !== null,
        action: { label: 'Compose email', type: 'compose', target: 'building_contract' },
      },
    ],
    skipAllowed: false,
  },

  // ── STEP 14 ──────────────────────────────────────────────────────────────
  {
    id: 'building_permit',
    label: 'Building permit obtained',
    description: 'Building permit approved before works commence.',
    category: 'contract',
    isComplete: (ctx) => ctx.job.building_permit_obtained_at !== null,
    isVisible: (ctx) => ctx.buildingPermitRequired,
    primaryAction: {
      label: 'Go to Files',
      type: 'navigate',
      target: 'files',
    },
    skipAllowed: false,
  },

  // ── STEP 15 ──────────────────────────────────────────────────────────────
  {
    id: 'blueprint_confirmed',
    label: 'Repair schedule confirmed',
    description: 'Trade allocation and visit sequence reviewed and confirmed.',
    category: 'repairs',
    isComplete: (ctx) => ctx.blueprint.status === 'confirmed',
    isVisible: (ctx) =>
      ctx.quotes.some(q => q.quote_type === 'inspection' && q.status === 'approved'),
    primaryAction: {
      label: 'Go to Trade Work Orders',
      type: 'navigate',
      target: 'trade-work-orders',
    },
    skipAllowed: false,
  },

  // ── STEP 16 ──────────────────────────────────────────────────────────────
  {
    id: 'trades_engaged',
    label: 'Trades engaged',
    description: 'All trades have confirmed and works are underway.',
    category: 'repairs',
    isComplete: (ctx) =>
      ctx.workOrders.length > 0 &&
      ctx.workOrders.every(wo => wo.status !== 'pending' && wo.status !== null),
    isVisible: (ctx) => ctx.blueprint.exists,
    primaryAction: {
      label: 'Go to Trade Work Orders',
      type: 'navigate',
      target: 'trade-work-orders',
    },
    skipAllowed: false,
  },

  // ── STEP 17 ──────────────────────────────────────────────────────────────
  {
    id: 'works_complete',
    label: 'Works complete',
    description: 'All trade visits finished.',
    category: 'repairs',
    isComplete: (ctx) =>
      ctx.workOrderVisits.length > 0 &&
      ctx.workOrderVisits.every(v => v.status === 'complete'),
    isVisible: (ctx) => ctx.blueprint.exists,
    primaryAction: {
      label: 'Go to Trade Work Orders',
      type: 'navigate',
      target: 'trade-work-orders',
    },
    skipAllowed: false,
  },

  // ── STEP 18 ──────────────────────────────────────────────────────────────
  {
    id: 'trade_invoices_approved',
    label: 'Trade invoices approved',
    description: 'All inbound trade invoices reviewed and approved.',
    category: 'invoice',
    isComplete: (ctx) =>
      ctx.invoices.inbound.length > 0 &&
      ctx.invoices.inbound.every(inv => inv.status === 'approved'),
    isVisible: (ctx) => ctx.blueprint.exists,
    primaryAction: {
      label: 'Go to Invoices',
      type: 'navigate',
      target: 'invoices',
    },
    skipAllowed: false,
  },

  // ── STEP 19 ──────────────────────────────────────────────────────────────
  {
    id: 'irc_invoices_sent',
    label: 'IRC invoices sent',
    description: 'All IRC invoices created and sent to insurer.',
    category: 'invoice',
    isComplete: (ctx) =>
      ctx.invoices.outbound.length > 0 &&
      ctx.invoices.outbound.every(inv => INVOICE_DONE_STATUSES.includes(inv.status ?? '')),
    isVisible: () => true,
    primaryAction: {
      label: 'Go to Invoices',
      type: 'navigate',
      target: 'invoices',
    },
    skipAllowed: false,
  },

  // ── STEP 20 ──────────────────────────────────────────────────────────────
  {
    id: 'payment_received',
    label: 'Payment received',
    description: 'All IRC invoices paid (confirmed via Xero sync).',
    category: 'invoice',
    isComplete: (ctx) =>
      ctx.invoices.outbound.length > 0 &&
      ctx.invoices.outbound.every(inv => inv.status === 'paid'),
    isVisible: () => true,
    // Read-only from Xero — no action button
    skipAllowed: false,
  },

  // ── STEP 21 ──────────────────────────────────────────────────────────────
  {
    id: 'job_closed',
    label: 'Job closed',
    description: 'All tasks complete. Job marked as closed.',
    category: 'close',
    isComplete: (ctx) => ctx.job.status === 'complete',
    isVisible: () => true,
    primaryAction: {
      label: 'Mark job complete',
      type: 'inline',
      target: 'close_job',
    },
    skipAllowed: false,
  },
]
