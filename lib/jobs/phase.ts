import type { SupabaseClient } from '@supabase/supabase-js'

// Job phases (tech spec §5b "Job phases", migration 20261123_job_phases.sql):
// the five phases the office thinks in, and the next step inside each,
// worked out from the job's records — never set by hand except closing.
//
//   assessment        book the inspection → attend → write the report and quote → submit
//   awaiting_decision sent, waiting on the insurer
//   in_repair         homeowner signs → book trades → works under way → sign-off
//   invoicing         trade invoices in → invoice the insurer → waiting on payment
//   closed            complete / declined / cancelled / no decision
//
// On hold is a flag on top (jobs.override_stage 'on_hold'), not a phase.
// Report-only jobs (a make safe, a roof report, no quote) go assessment →
// invoicing → closed. A job closes only when every invoice on it is paid.
// The safety net (lapse, below) closes a job the insurer never decides on.
//
// Phase changes are cheap and certain: a database trigger flags the job when
// anything it's worked out from changes (quotes, reports, inspections,
// invoices, work order visits, sign-off, completion) and the minute cron works
// the flagged ones out again (recomputeStalePhases).

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

/** Invoices for an assessment's own work (the report fees), as against the repair */
const FEE_TYPES = new Set(['assessment', 'make_safe', 'roof', 'leak_detection'])
/** The homeowner's excess: owed, but not the insurer's invoice for the works */
const EXCESS = 'excess'

export type PhaseContext = {
  job: {
    override_stage: string | null
    homeowner_signoff_sent_at: string | null
    homeowner_signoff_received_at: string | null
    completion_approved_at: string | null
    lapsed_at: string | null
    closed_by_hand: string | null
  }
  /** Active quote versions: status */
  quotes: { status: string | null }[]
  reports: { report_type: string; status: string | null; deleted_at?: string | null }[]
  inspections: { status: string | null; form_submitted_at: string | null }[]
  visits: { status: string | null }[]
  invoices: { direction: string | null; invoice_type: string | null; status: string | null }[]
  /** A calendar appointment is linked to the job (it's booked) */
  hasAppointment: boolean
}

export type PhaseResult = { phase: Phase; step: PhaseStep | null; closedReason: ClosedReason | null }

const result = (phase: Phase, step: PhaseStep | null = null, closedReason: ClosedReason | null = null): PhaseResult => ({ phase, step, closedReason })

/** The job's phase and next step, from its records */
export function computePhase(ctx: PhaseContext): PhaseResult {
  const { job } = ctx
  if (job.override_stage === 'cancelled') return result('closed', null, 'cancelled')

  const ours = ctx.invoices.filter(i => i.direction !== 'inbound' && i.status !== 'voided')
  const unpaid = ours.filter(i => i.status !== 'paid')
  const allPaid = ours.length > 0 && unpaid.length === 0
  const works = ours.filter(i => !FEE_TYPES.has(i.invoice_type ?? '') && i.invoice_type !== EXCESS)
  const tradeInvoices = ctx.invoices.filter(i => i.direction === 'inbound' && i.status !== 'voided')

  const statuses = new Set(ctx.quotes.map(q => q.status ?? ''))
  const approved = statuses.has('approved') || statuses.has('partially_approved')
  const sent = statuses.has('sent')
  const declined = !approved && !sent && statuses.has('rejected')

  // Closed by hand (the clean-up, or the office) — unless an approval came since
  if (job.closed_by_hand && !(approved && job.closed_by_hand === 'no_decision')) {
    return result('closed', null, job.closed_by_hand as ClosedReason)
  }

  if (approved) {
    const visitsDone = ctx.visits.length > 0 && ctx.visits.every(v => v.status === 'complete')
    const worksDone = !!job.completion_approved_at || visitsDone || works.length > 0
    if (!worksDone) {
      const started = ctx.visits.some(v => v.status && v.status !== 'unscheduled')
      if (!started && !job.homeowner_signoff_received_at) {
        return result('in_repair', job.homeowner_signoff_sent_at ? 'awaiting_signature' : 'get_signed')
      }
      if (!started) return result('in_repair', 'book_trades')
      return result('in_repair', 'works_underway')
    }
    if (visitsDone && !job.completion_approved_at && works.length === 0) return result('in_repair', 'record_signoff')
    if (works.length > 0 && allPaid) return result('closed', null, 'complete')
    if (works.length === 0) {
      return result('invoicing', tradeInvoices.some(i => i.status !== 'approved' && i.status !== 'paid') ? 'trade_invoices' : 'invoice_insurer')
    }
    return result('invoicing', works.some(i => i.status === 'draft') ? 'invoice_insurer' : 'awaiting_payment')
  }

  if (declined) {
    // A declined claim still owes its report fee: closed once that's paid
    if (unpaid.length) return result('invoicing', unpaid.some(i => i.status === 'draft') ? 'invoice_fee' : 'awaiting_payment')
    return result('closed', null, 'declined')
  }

  if (sent) {
    if (job.lapsed_at) return result('closed', null, 'no_decision')
    return result('awaiting_decision', 'waiting_on_insurer')
  }

  // Not quoted (or the quote's still being written)
  const reports = ctx.reports.filter(r => !r.deleted_at && r.status !== 'cancelled')
  const reportSent = reports.some(r => r.status === 'sent')
  const quoting = statuses.has('draft') || statuses.has('ready')
  if (reportSent && !quoting) {
    // A report-only job (a make safe, a roof report): invoice it, then it's done
    if (ours.length === 0) return result('invoicing', 'invoice_fee')
    if (allPaid) return result('closed', null, 'complete')
    return result('invoicing', unpaid.some(i => i.status === 'draft') ? 'invoice_fee' : 'awaiting_payment')
  }

  const inspection = ctx.inspections.find(i => i.status !== 'cancelled') ?? null
  const visited = !!inspection?.form_submitted_at || ['submitted', 'sent_and_locked', 'review_and_send_all_docs'].includes(inspection?.status ?? '')
  if (visited || reports.some(r => r.status === 'complete') || quoting) {
    const ready = statuses.has('ready') || reports.some(r => r.status === 'complete')
    return result('assessment', ready ? 'submit' : 'write_report')
  }
  const booked = ctx.hasAppointment || inspection?.status === 'appointment_confirmed'
  return result('assessment', booked ? 'attend' : 'book_inspection')
}

/**
 * The old stage key that matches a phase and step, still written to
 * jobs.current_stage so what reads it (the job page's action buttons, the
 * signing flow, email-to-job matching) agrees with the phase.
 */
export function legacyStage(r: PhaseResult, overrideStage: string | null = null): string {
  if (overrideStage === 'on_hold') return 'on_hold'
  if (r.phase === 'closed') return r.closedReason === 'cancelled' ? 'cancelled' : 'complete'
  const byStep: Record<PhaseStep, string> = {
    book_inspection: 'awaiting_schedule', attend: 'inspection_scheduled', write_report: 'awaiting_compilation', submit: 'awaiting_compilation',
    waiting_on_insurer: 'sent_awaiting_approval',
    get_signed: 'approved_awaiting_signoff', awaiting_signature: 'awaiting_signed_document', book_trades: 'signed_build_schedule',
    works_underway: 'repairs_in_progress', record_signoff: 'awaiting_completion_signoff',
    trade_invoices: 'awaiting_trade_invoices', invoice_insurer: 'ready_to_invoice', invoice_fee: 'ready_to_invoice', awaiting_payment: 'invoiced_awaiting_payment',
  }
  return r.step ? byStep[r.step] : 'awaiting_compilation'
}

// ── Loading, saving, and the stale-job sweep ──

type CurrentPhase = { tenant_id: string | null; phase: string | null; phase_step: string | null; phase_since: string | null; closed_reason: string | null; created_at: string | null; current_stage: string | null }

export async function loadPhaseContext(db: SupabaseClient, jobId: string): Promise<PhaseContext & { current: CurrentPhase } | null> {
  const [{ data: job }, { data: quotes }, { data: reports }, { data: inspections }, { data: visits }, { data: invoices }, { count }] = await Promise.all([
    db.from('jobs').select('override_stage, homeowner_signoff_sent_at, homeowner_signoff_received_at, completion_approved_at, lapsed_at, closed_by_hand, tenant_id, phase, phase_step, phase_since, closed_reason, created_at, current_stage').eq('id', jobId).maybeSingle(),
    db.from('quotes').select('status, created_at').eq('job_id', jobId).eq('is_active_version', true),
    db.from('reports').select('report_type, status, deleted_at').eq('job_id', jobId),
    db.from('inspections').select('status, form_submitted_at').eq('job_id', jobId),
    db.from('work_order_visits').select('status').eq('job_id', jobId),
    db.from('invoices').select('direction, invoice_type, status').eq('job_id', jobId),
    db.from('calendar_events').select('id', { count: 'exact', head: true }).eq('job_id', jobId).neq('status', 'cancelled'),
  ])
  if (!job) return null
  const j = job as PhaseContext['job'] & CurrentPhase
  return {
    job: j,
    quotes: (quotes as { status: string | null }[] | null) ?? [],
    reports: (reports as PhaseContext['reports'] | null) ?? [],
    inspections: (inspections as PhaseContext['inspections'] | null) ?? [],
    visits: (visits as PhaseContext['visits'] | null) ?? [],
    invoices: (invoices as PhaseContext['invoices'] | null) ?? [],
    hasAppointment: (count ?? 0) > 0,
    current: { tenant_id: j.tenant_id ?? null, phase: j.phase, phase_step: j.phase_step ?? null, phase_since: j.phase_since, closed_reason: j.closed_reason, created_at: j.created_at, current_stage: j.current_stage },
  }
}

/** Works a job's phase out again and saves it. Returns it, or null if the job's gone */
export async function recomputePhase(db: SupabaseClient, jobId: string, at = new Date()): Promise<PhaseResult | null> {
  const ctx = await loadPhaseContext(db, jobId)
  if (!ctx) return null
  const out = computePhase(ctx)
  const moved = ctx.current.phase !== out.phase
  // The first time a job is worked out, awaiting_decision's clock starts when the quote went
  // (its sent quote's date — sending isn't timed), so a long-waiting job can lapse
  let since = ctx.current.phase_since
  if (moved || !since) {
    if (!ctx.current.phase && out.phase === 'awaiting_decision') {
      const { data } = await db.from('quotes').select('created_at').eq('job_id', jobId).eq('is_active_version', true).eq('status', 'sent').order('created_at', { ascending: false }).limit(1)
      since = ((data as { created_at: string }[] | null) ?? [])[0]?.created_at ?? ctx.current.created_at ?? at.toISOString()
    } else {
      since = at.toISOString()
    }
  }
  const stage = legacyStage(out, ctx.job.override_stage)
  await db.from('jobs').update({
    phase: out.phase, phase_step: out.step, closed_reason: out.closedReason, phase_since: since, phase_stale: false,
    ...(stage !== ctx.current.current_stage ? { current_stage: stage, current_stage_updated_at: at.toISOString() } : {}),
    // An approval after a lapse reopens the job
    ...(out.phase !== 'closed' && ctx.job.lapsed_at ? { lapsed_at: null } : {}),
  }).eq('id', jobId)
  // Into the job's ledger: a move to another phase or step (not the first time a job is worked out)
  const changed = moved || (ctx.current.phase_step ?? null) !== out.step || (ctx.current.closed_reason ?? null) !== out.closedReason
  if (ctx.current.phase && changed && ctx.current.tenant_id) {
    const { recordSystemEvent } = await import('@/lib/activity/log')
    const now = describePhase({ phase: out.phase, phase_step: out.step, closed_reason: out.closedReason })
    await recordSystemEvent({
      tenantId: ctx.current.tenant_id, jobId, event: 'job.phase', service: db as never,
      summary: moved ? `Moved to ${now} (was ${phaseLabel(ctx.current.phase)})` : `Next step: ${now}`,
    })
  }
  return out
}

/** The minute cron: jobs flagged since anything they're worked out from changed */
export async function recomputeStalePhases(db: SupabaseClient, limit = 100): Promise<number> {
  const { data } = await db.from('jobs').select('id').eq('phase_stale', true).limit(limit)
  let n = 0
  for (const j of (data as { id: string }[] | null) ?? []) {
    try {
      await recomputePhase(db, j.id)
      n++
    } catch (err) {
      console.error(`[phase] job ${j.id} not worked out:`, err)
    }
  }
  return n
}
