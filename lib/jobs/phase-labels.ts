// Job phase names and labels (lib/jobs/phase.ts works the phases out). Kept
// apart so pages in the browser can show a phase without pulling in the
// server code phase.ts uses (the database, the activity log and what it loads).
// Safe to import in the browser.

export type Phase = 'assessment' | 'awaiting_decision' | 'in_repair' | 'invoicing' | 'closed'
export type ClosedReason = 'complete' | 'declined' | 'cancelled' | 'no_decision'
export type PhaseStep =
  | 'book_inspection' | 'attend' | 'write_report' | 'submit'
  | 'waiting_on_insurer'
  | 'get_signed' | 'awaiting_signature' | 'book_trades' | 'works_underway' | 'record_signoff'
  | 'trade_invoices' | 'invoice_insurer' | 'invoice_fee' | 'awaiting_payment'

export const PHASES: { key: Phase; label: string; description: string }[] = [
  { key: 'assessment', label: 'Assessment', description: 'Book, attend, write and submit the report and quote' },
  { key: 'awaiting_decision', label: 'Awaiting decision', description: 'Submitted — waiting on the insurer to approve or decline' },
  { key: 'in_repair', label: 'In repair', description: 'Approved — sign-off, trades and works' },
  { key: 'invoicing', label: 'Invoicing', description: 'Works or reports done — invoice and get paid' },
  { key: 'closed', label: 'Closed', description: 'Complete, declined, cancelled or no decision' },
]

export const STEP_LABELS: Record<PhaseStep, string> = {
  book_inspection: 'Book the inspection',
  attend: 'Attend',
  write_report: 'Write the report and quote',
  submit: 'Submit to the insurer',
  waiting_on_insurer: 'Waiting on the insurer',
  get_signed: 'Get the homeowner to sign',
  awaiting_signature: 'Waiting on the homeowner\'s signature',
  book_trades: 'Book the trades',
  works_underway: 'Works under way',
  record_signoff: 'Record the homeowner\'s sign-off',
  trade_invoices: 'Get the trade invoices in',
  invoice_insurer: 'Invoice the insurer',
  invoice_fee: 'Invoice the report fee',
  awaiting_payment: 'Waiting on payment',
}

export const CLOSED_LABELS: Record<ClosedReason, string> = {
  complete: 'Complete', declined: 'Declined', cancelled: 'Cancelled', no_decision: 'No decision',
}

export const phaseLabel = (p: string | null | undefined) => PHASES.find(x => x.key === p)?.label ?? 'Assessment'

/** "In repair · Book the trades", "Closed · No decision", with "On hold" first when paused */
export function describePhase(j: { phase: string | null; phase_step: string | null; closed_reason: string | null; override_stage?: string | null }): string {
  const head = phaseLabel(j.phase)
  const tail = j.phase === 'closed'
    ? CLOSED_LABELS[j.closed_reason as ClosedReason] ?? null
    : STEP_LABELS[j.phase_step as PhaseStep] ?? null
  return `${j.override_stage === 'on_hold' ? 'On hold — ' : ''}${head}${tail ? ` · ${tail}` : ''}`
}
