import type { SupabaseClient } from '@supabase/supabase-js'
import { isoToPerthLocal, perthLocalToIso } from '@/lib/mail/schedule-rules'
import { PRIORITY } from '@/lib/actions/cards'

// The check-in after a job appointment (tech spec §23.13): a couple of hours
// after a job's calendar appointment ends (or first thing the next working
// morning, if that's after hours or the weekend), an action card is queued
// for it — one per appointment (action_queue source 'appointment',
// source_ref the calendar_events row). The card AI (lib/actions/propose.ts,
// appointmentContext) reads what's been recorded on the job since: a note
// saying it's all sorted → nothing to do (no_action); something outstanding
// (a report to finish and send, a problem noted) → the next steps drafted;
// nothing recorded at all → a card asking what happened.

/** How long after an appointment ends it's checked */
const AFTER_MS = 2 * 3_600_000
/** Appointments that ended longer ago than this aren't checked (the first run doesn't reach back weeks) */
const LOOK_BACK_MS = 3 * 86_400_000
const OFFICE_OPENS = '07:00'
const OFFICE_CLOSES = '17:30'
const CHECK_AT = '08:00'

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())

/** When an appointment that ended at `endIso` is checked: 2 hours on, inside office hours, else the next working morning */
export function checkInDue(endIso: string): string {
  const soon = new Date(new Date(endIso).getTime() + AFTER_MS).toISOString()
  const local = isoToPerthLocal(soon)
  const day = local.slice(0, 10)
  const time = local.slice(11, 16)
  if (!isWeekend(day) && time >= OFFICE_OPENS && time < OFFICE_CLOSES) return soon
  let next = time < OFFICE_OPENS ? day : addDays(day, 1)
  while (isWeekend(next)) next = addDays(next, 1)
  return perthLocalToIso(`${next}T${CHECK_AT}`)!
}

type EventRow = { id: string; job_id: string; summary: string | null; start_at: string | null; end_at: string | null }

/**
 * Queues the check-in for each of a company's job appointments that's due
 * one and hasn't had it. Returns how many were queued.
 */
export async function queueAppointmentCheckIns(db: SupabaseClient, tenantId: string, at = new Date()): Promise<number> {
  const { data } = await db.from('calendar_events').select('id, job_id, summary, start_at, end_at')
    .eq('tenant_id', tenantId).not('job_id', 'is', null).neq('status', 'cancelled')
    .gte('end_at', new Date(at.getTime() - LOOK_BACK_MS).toISOString()).lte('end_at', at.toISOString())
  const due = ((data as EventRow[] | null) ?? []).filter(e => e.end_at && checkInDue(e.end_at) <= at.toISOString())
  if (!due.length) return 0
  const { data: existing } = await db.from('action_queue').select('source_ref')
    .eq('tenant_id', tenantId).eq('source', 'appointment').in('source_ref', due.map(e => e.id))
  const done = new Set(((existing as { source_ref: string }[] | null) ?? []).map(r => r.source_ref))
  let queued = 0
  for (const e of due) {
    if (done.has(e.id)) continue
    const { error } = await db.from('action_queue').insert({
      tenant_id: tenantId,
      job_id: e.job_id,
      source: 'appointment',
      source_ref: e.id,
      rule_key: 'appointment',
      title: `After: ${e.summary ?? 'the appointment'}`,
      status: 'queued',
      priority: PRIORITY.normal,
      category: 'other',
    })
    if (!error) queued++
  }
  return queued
}
