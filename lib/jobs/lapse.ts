import type { SupabaseClient } from '@supabase/supabase-js'
import { createFollowUp } from '@/lib/actions/followups'
import { pinnedTo } from '@/lib/actions/waits'

// The safety net for insurers who never decide (tech spec §5b "Job phases"):
// a job awaiting a decision longer than its insurer's lapse time
// (clients.decision_lapse_days, the Clients page; 180 days by default) closes
// as "no decision" — but only once every invoice on it is paid. Two weeks
// before, the office gets one check ("chase or let it lapse?"); if it's due to
// lapse with money still owed, one check to invoice or chase it instead. An
// approval that comes later reopens the job (lib/jobs/phase.ts).

const DEFAULT_LAPSE_DAYS = 180
const WARN_DAYS = 14
/** New checks per company a day: a backlog of old waits comes through a few at a time, not all at once */
const MAX_CHECKS_A_DAY = 3
const DAY_MS = 86_400_000

type JobRow = { id: string; tenant_id: string; job_number: string; insurer: string | null; client_id: string | null; phase_since: string | null; override_stage: string | null }

const day = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)).replace(',', '')

/** A check from the safety net, once per wait (since the job came into awaiting a decision) */
async function checkOnce(db: SupabaseClient, job: JobRow, ruleKey: 'lapse_warning' | 'lapse_blocked', note: string, why: string, at: Date): Promise<boolean> {
  const { data } = await db.from('action_queue').select('id').eq('job_id', job.id).eq('rule_key', ruleKey).gte('created_at', job.phase_since ?? '1970-01-01').limit(1)
  if ((data as unknown[] | null)?.length) return false
  const owner = await pinnedTo(db, job.tenant_id, null, job.id)
  await createFollowUp(db, job.tenant_id, owner.userId, { jobId: job.id, note, who: job.insurer, dueAt: new Date(at.getTime() + 2 * 60_000).toISOString(), watch: { why }, ruleKey })
  return true
}

/** Every company's jobs awaiting a decision: warned, lapsed, or flagged as owing money. Returns what happened */
export async function runLapses(db: SupabaseClient, at = new Date()): Promise<{ lapsed: string[]; warned: string[]; blocked: string[] }> {
  const out = { lapsed: [] as string[], warned: [] as string[], blocked: [] as string[] }
  const { data } = await db.from('jobs').select('id, tenant_id, job_number, insurer, client_id, phase_since, override_stage')
    .eq('phase', 'awaiting_decision').is('lapsed_at', null).is('closed_by_hand', null)
  const jobs = ((data as JobRow[] | null) ?? []).filter(j => j.phase_since && j.override_stage !== 'on_hold')
  if (!jobs.length) return out
  const clientIds = [...new Set(jobs.map(j => j.client_id).filter((id): id is string => !!id))]
  const { data: clients } = clientIds.length ? await db.from('clients').select('id, decision_lapse_days').in('id', clientIds) : { data: [] }
  const lapseDays = new Map(((clients as { id: string; decision_lapse_days: number | null }[] | null) ?? []).map(c => [c.id, c.decision_lapse_days]))

  const checksMade = new Map<string, number>()
  const room = (tenantId: string) => (checksMade.get(tenantId) ?? 0) < MAX_CHECKS_A_DAY
  const made = (tenantId: string) => checksMade.set(tenantId, (checksMade.get(tenantId) ?? 0) + 1)
  // The longest waits first
  jobs.sort((a, b) => (a.phase_since! < b.phase_since! ? -1 : 1))
  for (const job of jobs) {
    const days = lapseDays.get(job.client_id ?? '') ?? DEFAULT_LAPSE_DAYS
    if (!days || days <= 0) continue
    const lapsesAt = new Date(new Date(job.phase_since!).getTime() + days * DAY_MS)
    const who = job.insurer ?? 'The insurer'
    const howLong = days < 60 ? `${days} days` : `${Math.round(days / 30)} months`
    if (at >= lapsesAt) {
      const { data: inv } = await db.from('invoices').select('status, invoice_type').eq('job_id', job.id).eq('direction', 'outbound').neq('status', 'voided')
      const invoices = (inv as { status: string; invoice_type: string | null }[] | null) ?? []
      const unpaid = invoices.filter(i => i.status !== 'paid')
      if (invoices.length && !unpaid.length) {
        await db.from('jobs').update({ lapsed_at: at.toISOString() }).eq('id', job.id).is('lapsed_at', null)
        out.lapsed.push(job.job_number)
      } else if (room(job.tenant_id)) {
        const owed = !invoices.length ? 'nothing has been invoiced on it yet' : `${unpaid.length} invoice${unpaid.length === 1 ? ' is' : 's are'} still ${unpaid.some(i => i.status === 'draft') ? 'not sent or ' : ''}unpaid`
        if (await checkOnce(db, job, 'lapse_blocked', `${who} hasn't decided on ${job.job_number} in over ${howLong}. It can close as "no decision" once everything on it is paid, but ${owed}. Invoice or chase payment.`, 'The decision lapse time has passed', at)) { out.blocked.push(job.job_number); made(job.tenant_id) }
      }
    } else if (at.getTime() >= lapsesAt.getTime() - WARN_DAYS * DAY_MS && room(job.tenant_id)) {
      if (await checkOnce(db, job, 'lapse_warning', `${who} hasn't decided on ${job.job_number} since ${day(job.phase_since!)}. It closes as "no decision" on ${day(lapsesAt.toISOString())} unless they answer (an approval later reopens it). Chase them now if it's worth it.`, `Lapses in under ${WARN_DAYS} days`, at)) { out.warned.push(job.job_number); made(job.tenant_id) }
    }
  }
  return out
}
