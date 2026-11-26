import type { SupabaseClient } from '@supabase/supabase-js'

// Trade visit dates (tech spec §23.18 "Schedule"). A trade's day on site is
// its work order visit: scheduled_date, and scheduled_end_date for work over
// several days (the calendar shows it as a bar across them). Firm days only —
// "sometime next week" isn't a booking. Setting a day confirms the visit
// (status 'confirmed'); the job's phase trigger moves it from "book trades"
// to "works underway" by itself. Clearing goes back to 'unscheduled'.
// A visit is all day unless a start time is given ("electrician 7am") —
// like an all-day or timed event in a calendar. There's no end time. Moving a
// timed visit to another day keeps its time unless a new one (or all day) is said.

export class VisitScheduleError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/
const MAX_DAYS = 31

type VisitRow = { id: string; visit_number: number; status: string | null; scheduled_date: string | null; scheduled_end_date: string | null; start_time: string | null }

export type ScheduledVisit = {
  work_order_id: string
  visit_id: string
  visit_number: number
  total_visits: number
  start_date: string | null
  end_date: string | null
  /** Perth "07:00", or null: all day */
  start_time: string | null
  /** The day(s) it had before, when it was moved or cleared */
  previous: { start_date: string; end_date: string | null; start_time: string | null } | null
}

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null)

/** "7:00", "07:00" or "7:00:00" → "07:00"; null when it isn't a time */
export function normaliseTime(value: string): string | null {
  const m = value.trim().slice(0, 5).replace(/:$/, '').match(TIME)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1

/** Which visit a booking is for: the one asked for, else the first not done and not yet booked, else the only one not done */
function pickVisit(visits: VisitRow[], visitNumber?: number): VisitRow | { create: number } {
  if (visitNumber) {
    const hit = visits.find(v => v.visit_number === visitNumber)
    if (hit) return hit
    if (visitNumber === (visits.at(-1)?.visit_number ?? 0) + 1) return { create: visitNumber }
    throw new VisitScheduleError(`This work order has ${visits.length} visit${visits.length === 1 ? '' : 's'} — there's no visit ${visitNumber}.`)
  }
  if (!visits.length) return { create: 1 }
  const open = visits.filter(v => v.status !== 'complete')
  const unbooked = open.find(v => !v.scheduled_date)
  if (unbooked) return unbooked
  if (open.length === 1) return open[0]
  if (!open.length) throw new VisitScheduleError('Every visit on this work order is already complete.')
  throw new VisitScheduleError(`Every visit is already booked (${open.map(v => `visit ${v.visit_number}: ${v.scheduled_date}`).join(', ')}) — which one is moving?`)
}

/**
 * Books (or moves, or clears) a trade's visit on a work order: a firm start
 * day, and an end day for work over several days.
 */
export async function scheduleTradeVisit(db: SupabaseClient, params: {
  tenantId: string
  workOrderId: string
  /** "2026-12-03" */
  startDate?: string
  /** Last day, for work over several days */
  endDate?: string
  visitNumber?: number
  note?: string
  /** Perth start time "07:00" — leave out for all day (or to keep a moved visit's time) */
  startTime?: string
  /** All day: take a time off */
  allDay?: boolean
  /** Take the date off: the trade cancelled or it's not firm any more */
  clear?: boolean
}): Promise<ScheduledVisit> {
  const { tenantId, workOrderId } = params
  const { data: wo } = await db.from('work_orders').select('id, job_id, total_visits').eq('tenant_id', tenantId).eq('id', workOrderId).maybeSingle()
  const workOrder = wo as { id: string; job_id: string; total_visits: number | null } | null
  if (!workOrder) throw new VisitScheduleError('Work order not found.')

  const start = params.startDate?.trim()
  const end = params.endDate?.trim() || undefined
  if (!params.clear) {
    if (!start || !DATE.test(start)) throw new VisitScheduleError('Which day? A firm date like "2026-12-03" — "sometime next week" can\'t be booked.')
    if (end && !DATE.test(end)) throw new VisitScheduleError('The last day should be a date like "2026-12-05".')
    if (end && end < start) throw new VisitScheduleError('The last day is before the first.')
    if (end && dayCount(start, end) > MAX_DAYS) throw new VisitScheduleError(`That's more than ${MAX_DAYS} days on site — check the dates.`)
    if (params.startTime && !normaliseTime(params.startTime)) throw new VisitScheduleError('The start time should be like "07:00".')
  }

  const { data: rows } = await db.from('work_order_visits').select('id, visit_number, status, scheduled_date, scheduled_end_date, start_time')
    .eq('tenant_id', tenantId).eq('work_order_id', workOrderId).order('visit_number', { ascending: true })
  // Copies, so what each had before is kept for the reply
  const visits = ((rows as VisitRow[] | null) ?? []).map(v => ({ ...v }))

  if (params.clear) {
    const booked = visits.filter(v => v.scheduled_date && v.status !== 'complete')
    const target = params.visitNumber ? visits.find(v => v.visit_number === params.visitNumber) : booked.length === 1 ? booked[0] : null
    if (!target) {
      throw new VisitScheduleError(booked.length ? `Which visit? ${booked.map(v => `visit ${v.visit_number}: ${v.scheduled_date}`).join(', ')}.` : 'Nothing is booked on this work order.')
    }
    const { error } = await db.from('work_order_visits').update({
      scheduled_date: null, scheduled_end_date: null, start_time: null, confirmed_date: null, trade_confirmed_at: null, status: 'unscheduled',
      ...(params.note ? { notes: params.note } : {}),
    }).eq('tenant_id', tenantId).eq('id', target.id)
    if (error) throw error
    return {
      work_order_id: workOrderId, visit_id: target.id, visit_number: target.visit_number, total_visits: Math.max(visits.length, workOrder.total_visits ?? 1),
      start_date: null, end_date: null, start_time: null,
      previous: target.scheduled_date ? { start_date: target.scheduled_date, end_date: target.scheduled_end_date, start_time: hhmm(target.start_time) } : null,
    }
  }

  const picked = pickVisit(visits, params.visitNumber)
  // A time given; else all day if asked or new; else a moved visit keeps its time
  const time = params.startTime ? normaliseTime(params.startTime)
    : params.allDay || 'create' in picked ? null
    : hhmm(picked.start_time)
  const fields = {
    start_time: time,
    scheduled_date: start!,
    scheduled_end_date: end && end !== start ? end : null,
    confirmed_date: start!,
    trade_confirmed_at: new Date().toISOString(),
    status: 'confirmed',
    ...(params.note ? { notes: params.note } : {}),
  }

  let visit: VisitRow
  if ('create' in picked) {
    const { data, error } = await db.from('work_order_visits')
      .insert({ tenant_id: tenantId, work_order_id: workOrderId, job_id: workOrder.job_id, visit_number: picked.create, ...fields })
      .select('id, visit_number, status, scheduled_date, scheduled_end_date, start_time').single()
    if (error) throw error
    visit = { ...(data as VisitRow), scheduled_date: null, scheduled_end_date: null, start_time: null }
  } else {
    const { error } = await db.from('work_order_visits').update(fields).eq('tenant_id', tenantId).eq('id', picked.id)
    if (error) throw error
    visit = picked
  }

  const total = Math.max(visits.length + ('create' in picked ? 1 : 0), workOrder.total_visits ?? 1)
  return {
    work_order_id: workOrderId, visit_id: visit.id, visit_number: visit.visit_number, total_visits: total,
    start_date: fields.scheduled_date, end_date: fields.scheduled_end_date, start_time: time,
    previous: visit.scheduled_date ? { start_date: visit.scheduled_date, end_date: visit.scheduled_end_date, start_time: hhmm(visit.start_time) } : null,
  }
}
