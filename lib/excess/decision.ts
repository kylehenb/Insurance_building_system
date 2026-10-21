// What the office decided about a job's policy excess. Client-safe.
import { formatSigningDate } from '@/lib/signing/format'
//
// jobs.excess is the policy excess amount; jobs.excess_decision records what
// we're doing about it. NULL = not confirmed yet, so "no excess" and "not
// checked yet" are no longer both just a blank.

export type ExcessDecision =
  | 'collect'
  | 'nil'
  | 'cash_settlement'
  | 'insurer_waived'
  | 'already_paid'
  | 'other'

/** Reasons for not collecting an excess that exists. */
export type ExcessWaiverReason = 'cash_settlement' | 'insurer_waived' | 'already_paid' | 'other'

export const EXCESS_WAIVER_REASONS: { value: ExcessWaiverReason; label: string }[] = [
  { value: 'cash_settlement', label: 'Partial cash settlement — insurer already deducted it' },
  { value: 'insurer_waived', label: 'Insurer waived it' },
  { value: 'already_paid', label: 'Already paid' },
  { value: 'other', label: 'Other' },
]

export const EXCESS_DECISION_LABELS: Record<ExcessDecision, string> = {
  collect: 'Collecting excess',
  nil: 'No excess',
  cash_settlement: 'Not collected — cash settled',
  insurer_waived: 'Not collected — insurer waived',
  already_paid: 'Not collected — already paid',
  other: 'Not collected — other',
}

export const EXCESS_DECISIONS = Object.keys(EXCESS_DECISION_LABELS) as ExcessDecision[]

export interface ExcessInvoiceSummary {
  id: string
  ref: string | null
  amountIncGst: number
  status: string | null
  issuedDate: string | null
  paidDate: string | null
}

/** Everything the send dialog, badges and open loops need about a job's excess. */
export interface ExcessContext {
  /** Excess applies to insurance jobs only */
  applies: boolean
  /** jobs.excess (inc GST), null when blank */
  amount: number | null
  decision: ExcessDecision | null
  note: string | null
  decidedAt: string | null
  decidedByName: string | null
  /** Excess invoices already raised on this job, newest first */
  invoices: ExcessInvoiceSummary[]
}

/** What the office chose in the send dialog. */
export type ExcessChoice =
  /** Create a new excess invoice for this amount and attach it */
  | { kind: 'new_invoice'; amountIncGst: number }
  /** Attach an excess invoice already raised on the job */
  | { kind: 'attach_existing'; invoiceId: string }
  /** An excess invoice exists but don't attach it (already sent separately) */
  | { kind: 'existing_not_attached' }
  /** Confirmed: there's no excess on this claim */
  | { kind: 'no_excess' }
  /** There's an excess but we're not collecting it */
  | { kind: 'not_collecting'; reason: ExcessWaiverReason; note?: string | null }

/** True when an "Excess not confirmed" prompt should show for the job. */
export function excessNeedsConfirming(ctx: Pick<ExcessContext, 'applies' | 'amount' | 'decision'>): boolean {
  return ctx.applies && ctx.decision === null && !(ctx.amount && ctx.amount > 0)
}

/** Validates an excess choice posted from the browser. */
export function parseExcessChoice(raw: unknown): ExcessChoice | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  switch (r.kind) {
    case 'new_invoice': {
      const amount = typeof r.amountIncGst === 'number' ? r.amountIncGst : Number(r.amountIncGst)
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) return null
      return { kind: 'new_invoice', amountIncGst: Math.round(amount * 100) / 100 }
    }
    case 'attach_existing':
      return typeof r.invoiceId === 'string' && /^[0-9a-f-]{36}$/i.test(r.invoiceId)
        ? { kind: 'attach_existing', invoiceId: r.invoiceId }
        : null
    case 'existing_not_attached':
      return { kind: 'existing_not_attached' }
    case 'no_excess':
      return { kind: 'no_excess' }
    case 'not_collecting': {
      const reason = EXCESS_WAIVER_REASONS.find(x => x.value === r.reason)?.value
      if (!reason) return null
      const note = typeof r.note === 'string' ? r.note.trim().slice(0, 1000) : ''
      return { kind: 'not_collecting', reason, note: note || null }
    }
    default:
      return null
  }
}

/** The decision a choice records on the job. */
export function decisionForChoice(choice: ExcessChoice): ExcessDecision {
  switch (choice.kind) {
    case 'new_invoice':
    case 'attach_existing':
    case 'existing_not_attached':
      return 'collect'
    case 'no_excess':
      return 'nil'
    case 'not_collecting':
      return choice.reason
  }
}

/** "on receipt" or "by 4 Nov 2026", from the tenant's excess payment terms. */
export function excessDueText(issuedDate: string | null, termsDays: number | null | undefined): string {
  const days = termsDays ?? 0
  if (days <= 0 || !issuedDate) return 'on receipt'
  const due = new Date(`${issuedDate}T00:00:00+08:00`)
  due.setUTCDate(due.getUTCDate() + days)
  return `by ${new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', day: 'numeric', month: 'short', year: 'numeric' }).format(due)}`
}

const aud = (v: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)

/**
 * Neutral status line for an excess invoice. Accounts are reconciled in
 * batches, so a missing paid date means "check", never "unpaid".
 */
export function excessInvoiceStatusLine(inv: ExcessInvoiceSummary): string {
  const name = `Excess invoice ${inv.ref ?? ''}`.trim()
  if (inv.paidDate) return `Excess paid ${formatSigningDate(inv.paidDate)} (${name}, ${aud(inv.amountIncGst)})`
  const sent = inv.status && inv.status !== 'draft' && inv.issuedDate ? ` sent ${formatSigningDate(inv.issuedDate)}` : ''
  return `${name} (${aud(inv.amountIncGst)})${sent} — check it’s been paid before works start`
}
