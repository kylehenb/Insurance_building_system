import type { SupabaseClient } from '@supabase/supabase-js'
import { recordSystemEvent } from '@/lib/activity/log'
import { formatCases, recordLearning, similarCases, type Likeness, type Situation } from '@/lib/learning/events'
import { activeLessons, formatLessons } from '@/lib/learning/lessons'
import { dayLabel } from '@/lib/schedule/schedule'
import { findTradeWorkOrder, normaliseTime, scheduleTradeVisit, VisitScheduleError } from '@/lib/work-orders/visits'

// Done for you (tech spec §23.19): a trade's day put on the schedule because
// the office said so in an email it sent — "the painter will be there Tuesday",
// or "yes, Thursday works" to a day someone proposed. The sent-email read
// (lib/actions/waiting-on.ts) finds these; a day someone else only proposed
// isn't one. Firm days only. Each is kept in auto_actions with what was there
// before, shown in the Done for you list and on the job, and undone in one tap.
// Undoing it is the lesson: it's recorded for the learning module (§24), and
// the read is shown the lessons and the undone cases most like this email.

export const FEATURE = 'auto_booking'
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A booking the AI found in an email the office sent */
export type FoundBooking = { trade: string; start_date: string; end_date?: string | null; start_time?: string | null; evidence?: string | null }

export type AutoAction = {
  id: string; tenant_id: string; job_id: string | null; kind: 'trade_visit'; summary: string; source: 'sent_email'; source_ref: string | null
  evidence: string | null; target: { work_order_id?: string; visit_number?: number }; before: Days | null; after: Days | null
  status: 'done' | 'undone'; undone_at: string | null; undone_by: string | null; created_at: string
}
type Days = { start_date: string; end_date: string | null; start_time: string | null }

const COLUMNS = 'id, tenant_id, job_id, kind, summary, source, source_ref, evidence, target, before, after, status, undone_at, undone_by, created_at'

/** Which facts make two cases alike: who it was to, which trade */
export const BOOKING_LIKENESS: Likeness = { weights: { recipient_email: 4, recipient_domain: 2, trade: 2 }, minScore: 2 }

export const daysText = (d: Days) => `${dayLabel(d.start_date)}${d.end_date ? ` to ${dayLabel(d.end_date)}` : ''}${d.start_time ? ` at ${d.start_time}` : ''}`

function bookingSituation(to: { email: string } | null, trade: string): Situation {
  const email = to?.email.trim().toLowerCase() ?? null
  return { kind: 'sent_email', recipient_email: email, recipient_domain: email?.split('@')[1] ?? null, trade: trade.trim().toLowerCase() || null }
}

/** What the sent-email read is shown about past bookings: the lessons and the undone ones most like this email */
export async function bookingLearning(db: SupabaseClient, tenantId: string, to: { email: string } | null): Promise<string> {
  const [lessons, cases] = await Promise.all([
    activeLessons(db, tenantId, FEATURE),
    similarCases(db, { tenantId, feature: FEATURE, situation: bookingSituation(to, ''), likeness: BOOKING_LIKENESS }),
  ])
  const text = [formatLessons(lessons), formatCases(cases)].filter(Boolean).join('\n\n')
  return text ? `PAST BOOKINGS TAKEN FROM SENT EMAILS (how the office treated them)\n${text}` : ''
}

/**
 * Puts the bookings found in a sent email on the schedule. Returns a line per
 * booking for the read's outcome. Never throws: a booking it can't place
 * (no matching trade, two that match) is left for the office.
 */
export async function applyEmailBookings(db: SupabaseClient, params: {
  tenantId: string; jobId: string; jobNumber: string; messageId: string; to: { email: string } | null; bookings: FoundBooking[]
}): Promise<string[]> {
  const out: string[] = []
  for (const b of params.bookings.slice(0, 5)) {
    const start = (b.start_date ?? '').trim()
    if (!DATE.test(start)) continue
    const end = b.end_date && DATE.test(b.end_date) && b.end_date > start ? b.end_date : null
    const time = b.start_time ? normaliseTime(b.start_time) : null
    try {
      const pick = await findTradeWorkOrder(db, params.tenantId, params.jobId, b.trade ?? '')
      if (!('match' in pick)) {
        out.push(`${b.trade || 'A trade'} ${dayLabel(start)}: not booked — ${'several' in pick ? 'more than one work order matches' : 'no work order for it'}`)
        continue
      }
      const wo = pick.match
      // Already there as said: nothing to do
      const { data: visits } = await db.from('work_order_visits').select('visit_number, status, scheduled_date, scheduled_end_date, start_time')
        .eq('tenant_id', params.tenantId).eq('work_order_id', wo.id)
      const rows = (visits as { visit_number: number; status: string | null; scheduled_date: string | null; scheduled_end_date: string | null; start_time: string | null }[] | null) ?? []
      if (rows.some(v => v.scheduled_date === start && (v.scheduled_end_date ?? null) === end && (!time || (v.start_time ?? '').slice(0, 5) === time))) {
        out.push(`${wo.label} ${dayLabel(start)}: already on the schedule`)
        continue
      }
      // Not twice for the same email (a retried read)
      const { data: seen } = await db.from('auto_actions').select('id').eq('tenant_id', params.tenantId).eq('source', 'sent_email')
        .eq('source_ref', params.messageId).eq('target->>work_order_id', wo.id).maybeSingle()
      if (seen) continue

      const v = await scheduleTradeVisit(db, { tenantId: params.tenantId, workOrderId: wo.id, startDate: start, endDate: end ?? undefined, startTime: time ?? undefined })
      const after: Days = { start_date: v.start_date!, end_date: v.end_date, start_time: v.start_time }
      const before: Days | null = v.previous ? { start_date: v.previous.start_date, end_date: v.previous.end_date, start_time: v.previous.start_time } : null
      const summary = `${before ? 'Moved' : 'Booked'} the ${wo.label}${v.total_visits > 1 ? ` (visit ${v.visit_number})` : ''} on ${params.jobNumber} for ${daysText(after)}${before ? ` (was ${daysText(before)})` : ''}`
      const evidence = b.evidence?.trim().slice(0, 400) || null
      const { data: saved } = await db.from('auto_actions').insert({
        tenant_id: params.tenantId, job_id: params.jobId, kind: 'trade_visit', summary, source: 'sent_email', source_ref: params.messageId,
        evidence, target: { work_order_id: wo.id, visit_number: v.visit_number }, before, after,
      }).select('id').single()
      await recordSystemEvent({ tenantId: params.tenantId, jobId: params.jobId, event: 'schedule.auto', summary: `${summary} — from your email`, detail: evidence, service: db as never })
      await recordLearning(db, {
        tenantId: params.tenantId, feature: FEATURE, sourceTable: 'auto_actions', sourceId: (saved as { id: string } | null)?.id,
        situation: bookingSituation(params.to, wo.trade_name ?? b.trade), situationText: `Email the office sent to ${params.to?.email ?? 'someone'} about the ${wo.label}`,
        proposed: { trade: b.trade, start_date: start, end_date: end, start_time: time, evidence }, final: after, outcome: 'accepted', kind: 'trade_visit',
      })
      out.push(summary)
    } catch (err) {
      if (!(err instanceof VisitScheduleError)) console.error('[auto-bookings] booking failed:', err)
      out.push(`${b.trade || 'A trade'} ${dayLabel(start)}: not booked — ${err instanceof Error ? err.message : 'failed'}`)
    }
  }
  return out
}

/** The latest things done for you, newest first */
export async function listAutoActions(db: SupabaseClient, tenantId: string, opts: { days?: number; limit?: number } = {}): Promise<(AutoAction & { job_number: string | null })[]> {
  const since = new Date(Date.now() - (opts.days ?? 14) * 86_400_000).toISOString()
  const { data } = await db.from('auto_actions').select(COLUMNS).eq('tenant_id', tenantId).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(opts.limit ?? 30)
  const rows = (data as AutoAction[] | null) ?? []
  const jobIds = [...new Set(rows.map(r => r.job_id).filter((v): v is string => !!v))]
  const { data: jobs } = jobIds.length ? await db.from('jobs').select('id, job_number').eq('tenant_id', tenantId).in('id', jobIds) : { data: [] }
  const numbers = new Map(((jobs as { id: string; job_number: string }[] | null) ?? []).map(j => [j.id, j.job_number]))
  return rows.map(r => ({ ...r, job_number: r.job_id ? numbers.get(r.job_id) ?? null : null }))
}

export class AutoActionError extends Error {}

/**
 * Undoes something done for you: the visit goes back to the day(s) it had,
 * or off the schedule if it had none. Recorded for the learning module, with
 * the office's reason if they gave one.
 */
export async function undoAutoAction(db: SupabaseClient, tenantId: string, id: string, userId: string | null, reason?: string): Promise<AutoAction> {
  const { data } = await db.from('auto_actions').select(COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  const action = data as AutoAction | null
  if (!action) throw new AutoActionError('Not found.')
  if (action.status === 'undone') throw new AutoActionError('That was already undone.')
  const workOrderId = action.target.work_order_id
  if (!workOrderId) throw new AutoActionError('Nothing to undo.')
  const visitNumber = action.target.visit_number
  await (action.before
    ? scheduleTradeVisit(db, { tenantId, workOrderId, visitNumber, startDate: action.before.start_date, endDate: action.before.end_date ?? undefined, startTime: action.before.start_time ?? undefined, allDay: !action.before.start_time })
    : scheduleTradeVisit(db, { tenantId, workOrderId, visitNumber, clear: true }))
  const at = new Date().toISOString()
  const { data: updated } = await db.from('auto_actions').update({ status: 'undone', undone_at: at, undone_by: userId }).eq('tenant_id', tenantId).eq('id', id).select(COLUMNS).single()
  if (action.job_id) {
    await recordSystemEvent({ tenantId, jobId: action.job_id, event: 'schedule.auto', summary: `Undone: ${action.summary}`, detail: reason?.trim() || null, service: db as never })
  }
  // The same situation as when it was made, so it counts against alike emails
  const { data: made } = await db.from('learning_events').select('situation').eq('tenant_id', tenantId).eq('feature', FEATURE).eq('source_id', id).limit(1)
  const situation = ((made as { situation: Situation }[] | null) ?? [])[0]?.situation ?? { kind: 'sent_email' }
  await recordLearning(db, {
    tenantId, feature: FEATURE, sourceTable: 'auto_actions', sourceId: id,
    situation, situationText: `Booking taken from an email the office sent: ${action.summary}`,
    proposed: action.after, final: action.before, changes: [`Undone by the office: ${action.summary}`], outcome: reason?.trim() ? 'instructed' : 'skipped',
    instruction: reason, kind: 'trade_visit', userId,
  })
  return updated as AutoAction
}
