import type { SupabaseClient } from '@supabase/supabase-js'
import { isFieldAppJob } from '@/lib/jobs/field-app'

// The schedule (tech spec §23.18): everything happening on IRC's jobs, day by
// day, from three places:
//   - inspections with a date — their kind from their report (BAR → inspection,
//     make safe, roof report, leak detection, specialist);
//   - trade visits with a date (work_order_visits), over several days when
//     they have a last day;
//   - other appointments in the owner's calendar linked to a job (site
//     meetings…) — not the inspection's own event, and never personal ones.
// Two filters stack: what (kinds, a trade) and whose (a person). "Whose" is
// the inspector for an inspection, otherwise the person looking after the
// job (jobs.assigned_to). A job nobody's been given counts as the asker's own,
// since with one person in the office every job is theirs.
// Midcity's jobs are a separate business and stay out.

export const SCHEDULE_KINDS = ['inspection', 'make_safe', 'roof', 'leak_detection', 'specialist', 'repair', 'appointment'] as const
export type ScheduleKind = typeof SCHEDULE_KINDS[number]

export const KIND_LABELS: Record<ScheduleKind, string> = {
  inspection: 'Inspection', make_safe: 'Make safe', roof: 'Roof report', leak_detection: 'Leak detection',
  specialist: 'Specialist report', repair: 'Repair', appointment: 'Appointment',
}

/** An inspection's kind from its report's type */
export function inspectionKind(reportType: string | null | undefined): ScheduleKind {
  switch ((reportType ?? '').toLowerCase()) {
    case 'make_safe': return 'make_safe'
    case 'roof': case 'roof_report': return 'roof'
    case 'ldr': case 'leak_detection': return 'leak_detection'
    case 'specialist': return 'specialist'
    default: return 'inspection'
  }
}

export type ScheduleEntry = {
  kind: ScheduleKind
  start_date: string
  /** Last day, for work over several days (else the same as start_date) */
  end_date: string
  /** Perth "08:00" — null: all day (a trade's day on site with no time given) */
  time: string | null
  end_time: string | null
  title: string
  /** The trade's business, or the inspector */
  who: string | null
  job_id: string
  job_number: string
  address: string | null
  owner_id: string | null
  owner_name: string | null
  status: string | null
  source: { type: 'inspection' | 'visit' | 'appointment'; id: string }
  visit?: { number: number; total: number }
}

export type ScheduleFilters = {
  /** Perth "2026-12-03" */
  from: string
  to: string
  kinds?: ScheduleKind[]
  /** Only these people's (a user id) — omit for everyone's */
  personId?: string
  /** Count jobs nobody's been given as this person's */
  includeUnassigned?: boolean
  /** A trade or contractor, e.g. "painter" */
  trade?: string
  jobId?: string
}

const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000
const MAX_DAYS = 62

/** Perth's date today (or for an instant) */
export const perthDate = (at = new Date()) => new Date(at.getTime() + PERTH_OFFSET_MS).toISOString().slice(0, 10)
const perthTime = (iso: string) => new Date(new Date(iso).getTime() + PERTH_OFFSET_MS).toISOString().slice(11, 16)
const perthMidnight = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - PERTH_OFFSET_MS).toISOString()
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null)

type JobRow = { id: string; job_number: string; property_address: string | null; insurer: string | null; assigned_to: string | null }

export async function loadSchedule(db: SupabaseClient, tenantId: string, f: ScheduleFilters): Promise<ScheduleEntry[]> {
  if (f.to < f.from) throw new Error('The schedule\'s end is before its start')
  const to = f.to > addDays(f.from, MAX_DAYS) ? addDays(f.from, MAX_DAYS) : f.to
  const wants = (k: ScheduleKind) => !f.kinds?.length || f.kinds.includes(k)
  const wantsInspections = SCHEDULE_KINDS.filter(k => k !== 'repair' && k !== 'appointment').some(wants)

  // 1. Dated inspections, trade visits and job-linked appointments in the range
  const [inspRes, visitRes, eventRes, usersRes] = await Promise.all([
    wantsInspections
      ? db.from('inspections').select('id, job_id, report_id, inspector_id, inspection_ref, scheduled_date, start_time, finish_time, status, calendar_event_id')
          .eq('tenant_id', tenantId).gte('scheduled_date', f.from).lte('scheduled_date', to)
      : Promise.resolve({ data: [] }),
    wants('repair')
      ? db.from('work_order_visits').select('id, job_id, work_order_id, visit_number, status, scheduled_date, scheduled_end_date, start_time')
          .eq('tenant_id', tenantId).lte('scheduled_date', to).or(`scheduled_end_date.gte.${f.from},scheduled_date.gte.${f.from}`)
      : Promise.resolve({ data: [] }),
    wants('appointment')
      ? db.from('calendar_events').select('id, google_event_id, job_id, summary, start_at, end_at, all_day, status')
          .eq('tenant_id', tenantId).not('job_id', 'is', null).neq('status', 'cancelled')
          .gte('start_at', perthMidnight(f.from)).lt('start_at', perthMidnight(addDays(to, 1)))
      : Promise.resolve({ data: [] }),
    db.from('users').select('id, name').eq('tenant_id', tenantId),
  ])
  type Insp = { id: string; job_id: string; report_id: string | null; inspector_id: string | null; inspection_ref: string | null; scheduled_date: string; start_time: string | null; finish_time: string | null; status: string | null; calendar_event_id: string | null }
  type Visit = { id: string; job_id: string; work_order_id: string; visit_number: number; status: string | null; scheduled_date: string; scheduled_end_date: string | null; start_time: string | null }
  type Event = { id: string; google_event_id: string; job_id: string; summary: string | null; start_at: string; end_at: string | null; all_day: boolean | null; status: string | null }
  const forJob = (r: { job_id: string }) => !f.jobId || r.job_id === f.jobId
  const inspections = ((inspRes.data as Insp[] | null) ?? []).filter(i => forJob(i) && i.status !== 'reschedule_required' && i.status !== 'cancelled')
  const visits = ((visitRes.data as Visit[] | null) ?? []).filter(v => forJob(v) && (v.scheduled_end_date ?? v.scheduled_date) >= f.from)
  const events = ((eventRes.data as Event[] | null) ?? []).filter(forJob)
  const userName = new Map(((usersRes.data as { id: string; name: string | null }[] | null) ?? []).map(u => [u.id, u.name]))

  // 2. What they hang off: jobs, reports (an inspection's kind), work orders and trades
  const jobIds = [...new Set([...inspections, ...visits, ...events].map(r => r.job_id))]
  const inspIds = inspections.map(i => i.id)
  const reportIds = inspections.map(i => i.report_id).filter((v): v is string => !!v)
  const woIds = [...new Set(visits.map(v => v.work_order_id))]
  const eventIds = events.map(e => e.google_event_id)
  const none = Promise.resolve({ data: [] })
  const [jobsRes, reportsByIdRes, reportsByInspRes, woRes, ownEventsRes, visitCountRes] = await Promise.all([
    jobIds.length ? db.from('jobs').select('id, job_number, property_address, insurer, assigned_to').eq('tenant_id', tenantId).in('id', jobIds) : none,
    reportIds.length ? db.from('reports').select('id, inspection_id, report_type').eq('tenant_id', tenantId).in('id', reportIds) : none,
    inspIds.length ? db.from('reports').select('id, inspection_id, report_type').eq('tenant_id', tenantId).in('inspection_id', inspIds) : none,
    woIds.length ? db.from('work_orders').select('id, trade_name, trade_id, total_visits').eq('tenant_id', tenantId).in('id', woIds) : none,
    // An inspection's own event shows as the inspection, not twice
    eventIds.length ? db.from('inspections').select('calendar_event_id').eq('tenant_id', tenantId).in('calendar_event_id', eventIds) : none,
    woIds.length ? db.from('work_order_visits').select('work_order_id').eq('tenant_id', tenantId).in('work_order_id', woIds) : none,
  ])
  const jobs = new Map(((jobsRes.data as JobRow[] | null) ?? []).filter(j => !isFieldAppJob(j)).map(j => [j.id, j]))
  type Report = { id: string; inspection_id: string | null; report_type: string | null }
  const reports = [...((reportsByIdRes.data as Report[] | null) ?? []), ...((reportsByInspRes.data as Report[] | null) ?? [])]
  const reportType = (i: Insp) => (reports.find(r => r.id === i.report_id) ?? reports.find(r => r.inspection_id === i.id))?.report_type
  type Wo = { id: string; trade_name: string | null; trade_id: string | null; total_visits: number | null }
  const workOrders = new Map(((woRes.data as Wo[] | null) ?? []).map(w => [w.id, w]))
  const tradeIds = [...new Set([...workOrders.values()].map(w => w.trade_id).filter((v): v is string => !!v))]
  const { data: tradeRows } = tradeIds.length ? await db.from('trades').select('id, business_name').eq('tenant_id', tenantId).in('id', tradeIds) : { data: [] }
  const tradeName = new Map(((tradeRows as { id: string; business_name: string | null }[] | null) ?? []).map(t => [t.id, t.business_name]))
  const inspectionEvents = new Set(((ownEventsRes.data as { calendar_event_id: string | null }[] | null) ?? []).map(r => r.calendar_event_id))
  const visitCount = new Map<string, number>()
  for (const r of (visitCountRes.data as { work_order_id: string }[] | null) ?? []) visitCount.set(r.work_order_id, (visitCount.get(r.work_order_id) ?? 0) + 1)

  // 3. Into one list
  const out: ScheduleEntry[] = []
  const base = (job: JobRow, ownerId: string | null) => ({
    job_id: job.id, job_number: job.job_number, address: job.property_address,
    owner_id: ownerId, owner_name: ownerId ? userName.get(ownerId) ?? null : null,
  })
  for (const i of inspections) {
    const job = jobs.get(i.job_id)
    const kind = inspectionKind(reportType(i))
    if (!job || !wants(kind)) continue
    const inspector = i.inspector_id ? userName.get(i.inspector_id) ?? null : null
    out.push({
      ...base(job, i.inspector_id ?? job.assigned_to), kind, start_date: i.scheduled_date, end_date: i.scheduled_date,
      time: hhmm(i.start_time), end_time: hhmm(i.finish_time), title: KIND_LABELS[kind], who: inspector, status: i.status,
      source: { type: 'inspection', id: i.id },
    })
  }
  for (const v of visits) {
    const job = jobs.get(v.job_id)
    const wo = workOrders.get(v.work_order_id)
    if (!job || !wo) continue
    const total = Math.max(visitCount.get(wo.id) ?? 1, wo.total_visits ?? 1)
    out.push({
      ...base(job, job.assigned_to), kind: 'repair', start_date: v.scheduled_date, end_date: v.scheduled_end_date ?? v.scheduled_date,
      time: hhmm(v.start_time), end_time: null, title: wo.trade_name ?? 'Trade', who: wo.trade_id ? tradeName.get(wo.trade_id) ?? null : null, status: v.status,
      source: { type: 'visit', id: v.id }, ...(total > 1 ? { visit: { number: v.visit_number, total } } : {}),
    })
  }
  for (const e of events) {
    const job = jobs.get(e.job_id)
    if (!job || inspectionEvents.has(e.google_event_id)) continue
    const day = perthDate(new Date(e.start_at))
    out.push({
      ...base(job, job.assigned_to), kind: 'appointment', start_date: day,
      end_date: e.all_day && e.end_at ? addDays(perthDate(new Date(e.end_at)), -1) : day,
      time: e.all_day ? null : perthTime(e.start_at), end_time: e.all_day || !e.end_at ? null : perthTime(e.end_at),
      title: e.summary?.trim() || 'Appointment', who: null, status: e.status, source: { type: 'appointment', id: e.id },
    })
  }

  const trade = f.trade?.trim().toLowerCase()
  return out
    .filter(e => !f.personId || e.owner_id === f.personId || (!e.owner_id && f.includeUnassigned))
    .filter(e => !trade || (e.kind === 'repair' && [e.title, e.who].some(v => v?.toLowerCase().includes(trade))))
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || (a.time ?? '').localeCompare(b.time ?? '') || a.job_number.localeCompare(b.job_number))
}

/** Each day in the range with what's on it (work over several days shows on each of its days) */
export function scheduleByDay(entries: ScheduleEntry[], from: string, to: string): { date: string; entries: (ScheduleEntry & { day_of?: { day: number; days: number } })[] }[] {
  const days: { date: string; entries: (ScheduleEntry & { day_of?: { day: number; days: number } })[] }[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const on = entries.filter(e => e.start_date <= d && e.end_date >= d).map(e => {
      if (e.end_date === e.start_date) return e
      const days = Math.round((Date.parse(e.end_date) - Date.parse(e.start_date)) / 86_400_000) + 1
      return { ...e, day_of: { day: Math.round((Date.parse(d) - Date.parse(e.start_date)) / 86_400_000) + 1, days } }
    })
    days.push({ date: d, entries: on })
  }
  return days
}
