import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClosedReason } from './phase'

// Closing jobs by hand (tech spec §23.15): the old-jobs clean-up, and the
// office closing a job the records can't (a claim settled outside IRC). Sets
// jobs.closed_by_hand with its reason; the phase is worked out again (the
// database flags the job) and shows Closed with that reason. An approval that
// comes after a "no decision" close still reopens the job. Undo with
// reopenJob.

export const CLOSE_REASONS: ClosedReason[] = ['complete', 'declined', 'cancelled', 'no_decision']
export const isCloseReason = (v: unknown): v is ClosedReason => CLOSE_REASONS.includes(v as ClosedReason)

export class CloseJobError extends Error {
  constructor(message: string, public readonly status: 400 | 404 = 400) {
    super(message)
    this.name = 'CloseJobError'
  }
}

/** Closes the jobs with their reasons. Returns the job numbers closed */
export async function closeJobs(db: SupabaseClient, tenantId: string, items: { jobId: string; reason: ClosedReason }[]): Promise<string[]> {
  if (!items.length) throw new CloseJobError('Choose the jobs to close')
  if (items.some(i => !isCloseReason(i.reason))) throw new CloseJobError('A close reason is complete, declined, cancelled or no decision')
  const closed: string[] = []
  for (const { jobId, reason } of items) {
    const { data } = await db.from('jobs').update({ closed_by_hand: reason }).eq('tenant_id', tenantId).eq('id', jobId).select('job_number').maybeSingle()
    if (data) closed.push((data as { job_number: string }).job_number)
  }
  if (!closed.length) throw new CloseJobError('Those jobs weren\'t found', 404)
  return closed
}

/** Takes a hand close off: the job's phase comes from its records again */
export async function reopenJob(db: SupabaseClient, tenantId: string, jobId: string): Promise<string> {
  const { data } = await db.from('jobs').update({ closed_by_hand: null }).eq('tenant_id', tenantId).eq('id', jobId).select('job_number').maybeSingle()
  if (!data) throw new CloseJobError('Job not found', 404)
  return (data as { job_number: string }).job_number
}

// ── The clean-up of old jobs ──

/** Open jobs with nothing on them for this long are offered for closing */
const QUIET_DAYS = 90
const DAY_MS = 86_400_000
const FEE_TYPES = new Set(['assessment', 'make_safe', 'roof', 'leak_detection'])

export type CleanupCandidate = {
  id: string
  job_number: string
  property_address: string | null
  insurer: string | null
  phase: string | null
  phase_step: string | null
  last_activity: string | null
  suggested: ClosedReason
  why: string
}

type JobRow = { id: string; job_number: string; property_address: string | null; insurer: string | null; phase: string | null; phase_step: string | null; created_at: string | null; override_stage: string | null }
type Row = Record<string, string | null>

const PAGE = 1000
const CHUNK = 100

/** Every row of a query, a page at a time (a response holds at most 1000) */
async function allRows(query: (from: number, to: number) => PromiseLike<{ data: unknown }>): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data } = await query(from, from + PAGE - 1)
    const page = (data as Row[] | null) ?? []
    out.push(...page)
    if (page.length < PAGE) return out
  }
}

// What counts as activity on a job, and when it happened
const ACTIVITY: { table: string; at: string }[] = [
  { table: 'communications', at: 'created_at' },
  { table: 'action_queue', at: 'updated_at' },
  { table: 'calendar_events', at: 'start_at' },
  { table: 'quotes', at: 'created_at' },
  { table: 'invoices', at: 'created_at' },
]

/**
 * Open jobs (not on hold) with nothing on them for 90 days, each with the
 * reason it most likely closed and why: works invoiced → complete; a quote
 * approved → complete; declined → declined; with the insurer → no decision;
 * a fee invoiced → complete; never quoted or invoiced → cancelled. Most
 * recently active first. Nothing is closed here.
 */
export async function cleanupCandidates(db: SupabaseClient, tenantId: string, at = new Date()): Promise<CleanupCandidate[]> {
  const quiet = new Date(at.getTime() - QUIET_DAYS * DAY_MS).toISOString()
  const open = (await allRows((f, t) => db.from('jobs')
    .select('id, job_number, property_address, insurer, phase, phase_step, created_at, override_stage')
    .eq('tenant_id', tenantId).or('phase.is.null,phase.neq.closed').order('id').range(f, t))) as unknown as JobRow[]

  // Jobs with anything in the last 90 days are out — only recent rows are read
  const active = new Set<string>()
  for (const { table, at: col } of ACTIVITY) {
    const rows = await allRows((f, t) => db.from(table).select('job_id').eq('tenant_id', tenantId).not('job_id', 'is', null).gte(col, quiet).order('id').range(f, t))
    for (const r of rows) active.add(r.job_id!)
  }
  const jobs = open.filter(j => j.override_stage !== 'on_hold' && (j.created_at ?? '') < quiet && !active.has(j.id))
  if (!jobs.length) return []

  // Then everything on the quiet ones, a chunk of jobs at a time
  const last = new Map<string, string>()
  const touch = (id: string | null, t: string | null) => { if (id && t && (!last.has(id) || t > last.get(id)!)) last.set(id, t) }
  const quotes: Row[] = []
  const invoices: Row[] = []
  for (const j of jobs) touch(j.id, j.created_at)
  for (let i = 0; i < jobs.length; i += CHUNK) {
    const ids = jobs.slice(i, i + CHUNK).map(j => j.id)
    for (const { table, at: col } of ACTIVITY) {
      const cols = table === 'quotes' ? `job_id, ${col}, status, is_active_version`
        : table === 'invoices' ? `job_id, ${col}, status, invoice_type, direction` : `job_id, ${col}`
      const rows = await allRows((f, t) => db.from(table).select(cols).eq('tenant_id', tenantId).in('job_id', ids).order('id').range(f, t))
      for (const r of rows) touch(r.job_id, r[col])
      if (table === 'quotes') quotes.push(...rows.filter(r => (r.is_active_version as unknown) !== false))
      if (table === 'invoices') invoices.push(...rows.filter(r => r.status !== 'voided' && r.direction !== 'inbound'))
    }
  }

  return jobs
    .map(j => {
      const q = quotes.filter(r => r.job_id === j.id).map(r => r.status)
      const inv = invoices.filter(r => r.job_id === j.id)
      const works = inv.filter(r => !FEE_TYPES.has(r.invoice_type ?? '') && r.invoice_type !== 'excess')
      const [suggested, why]: [ClosedReason, string] =
        works.length ? ['complete', 'The works were invoiced']
        : q.includes('approved') ? ['complete', 'The quote was approved']
        : q.includes('rejected') ? ['declined', 'The quote was declined']
        : q.includes('sent') ? ['no_decision', 'The quote went to the insurer and no decision came']
        : inv.length ? ['complete', 'The report fee was invoiced']
        : ['cancelled', 'Never quoted or invoiced']
      return { id: j.id, job_number: j.job_number, property_address: j.property_address, insurer: j.insurer, phase: j.phase, phase_step: j.phase_step, last_activity: last.get(j.id) ?? null, suggested, why }
    })
    .sort((a, b) => ((a.last_activity ?? '') < (b.last_activity ?? '') ? 1 : -1))
}
