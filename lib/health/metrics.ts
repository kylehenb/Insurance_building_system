import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, dayStartIso, daysBetween, perthDay } from './periods'
import { FIELD_APP_INSURER, isFieldAppJob } from '@/lib/jobs/field-app'

// The health check's daily figures (tech spec §25.3). Each is worked out per
// Perth day from records that carry a date, so past days can be filled in
// too, and kept in health_daily. A week, month, quarter or year adds the days
// up ("sum"), or takes the latest day's value for a figure that's a level at a
// point in time ("last": open jobs, money owed, database size).
//
// To add a figure: add it to METRICS, work it out in computeDays, and bump
// METRICS_VERSION. The nightly run then recomputes every past day.
//
// Midcity (a separate business run from the same system, lib/jobs/field-app.ts)
// is left out of IRC's figures: its jobs, their inspections and the open-jobs
// count. Its AI use is shown on its own lines, not inside IRC's spend.

export const METRICS_VERSION = 2

/**
 * The first full day the system figures (AI calls, scheduled jobs, errors)
 * were recorded (§25.1). Before it they're "not tracked", not zero.
 */
export const SYSTEM_TRACKING_SINCE = '2026-11-03'

export type MetricGroup = 'Work in' | 'Work done' | 'Money' | 'On time' | 'AI' | 'Systems' | 'Limits'
export type MetricUnit = 'count' | 'aud' | 'usd' | 'bytes'

export interface MetricDef {
  key: string
  label: string
  group: MetricGroup
  /** sum: add the days up; last: the latest day's value */
  kind: 'sum' | 'last'
  unit: MetricUnit
  /** Recorded only from SYSTEM_TRACKING_SINCE */
  system?: boolean
  /** Taken only on the night after the day (a level, can't be worked out for the past) */
  snapshot?: boolean
}

export const METRICS: MetricDef[] = [
  // Work in
  { key: 'orders_received', label: 'Insurer orders received', group: 'Work in', kind: 'sum', unit: 'count' },
  { key: 'jobs_created', label: 'Jobs created', group: 'Work in', kind: 'sum', unit: 'count' },
  { key: 'emails_in', label: 'Emails received', group: 'Work in', kind: 'sum', unit: 'count' },
  { key: 'portal_in', label: 'Portal messages received', group: 'Work in', kind: 'sum', unit: 'count' },
  // Work done
  { key: 'inspections_done', label: 'Inspections submitted', group: 'Work done', kind: 'sum', unit: 'count' },
  { key: 'quotes_created', label: 'Quotes created', group: 'Work done', kind: 'sum', unit: 'count' },
  { key: 'work_orders_created', label: 'Work orders created', group: 'Work done', kind: 'sum', unit: 'count' },
  { key: 'signing_sent', label: 'Sent for signature', group: 'Work done', kind: 'sum', unit: 'count' },
  { key: 'signing_signed', label: 'Signed', group: 'Work done', kind: 'sum', unit: 'count' },
  { key: 'jobs_completed', label: 'Jobs completed', group: 'Work done', kind: 'sum', unit: 'count' },
  { key: 'emails_out', label: 'Emails sent', group: 'Work done', kind: 'sum', unit: 'count' },
  { key: 'staff_actions', label: 'Actions logged', group: 'Work done', kind: 'sum', unit: 'count' },
  { key: 'voice_actions', label: 'Done by voice', group: 'Work done', kind: 'sum', unit: 'count' },
  { key: 'open_jobs', label: 'Open jobs', group: 'Work done', kind: 'last', unit: 'count', snapshot: true },
  // Money
  { key: 'invoices_issued', label: 'Invoices issued', group: 'Money', kind: 'sum', unit: 'count' },
  { key: 'invoiced_aud', label: 'Invoiced (inc GST)', group: 'Money', kind: 'sum', unit: 'aud' },
  { key: 'payments_received', label: 'Invoices paid', group: 'Money', kind: 'sum', unit: 'count' },
  { key: 'paid_aud', label: 'Paid (inc GST)', group: 'Money', kind: 'sum', unit: 'aud' },
  { key: 'owed_aud', label: 'Owed to us (inc GST)', group: 'Money', kind: 'last', unit: 'aud', snapshot: true },
  { key: 'overdue_aud', label: 'Owed over 30 days', group: 'Money', kind: 'last', unit: 'aud', snapshot: true },
  // On time (insurer KPIs: contact, booking, visit, report)
  { key: 'kpi_met', label: 'Insurer deadlines met', group: 'On time', kind: 'sum', unit: 'count' },
  { key: 'kpi_missed', label: 'Insurer deadlines missed', group: 'On time', kind: 'sum', unit: 'count' },
  // AI: what the office did with its proposals (learning module), and what it cost
  { key: 'action_cards_made', label: 'Action cards made', group: 'AI', kind: 'sum', unit: 'count' },
  { key: 'ai_accepted', label: 'AI proposals accepted as is', group: 'AI', kind: 'sum', unit: 'count' },
  { key: 'ai_edited', label: 'AI proposals edited', group: 'AI', kind: 'sum', unit: 'count' },
  { key: 'ai_instructed', label: 'AI proposals sent back with instructions', group: 'AI', kind: 'sum', unit: 'count' },
  { key: 'ai_skipped', label: 'AI proposals skipped', group: 'AI', kind: 'sum', unit: 'count' },
  { key: 'ai_calls', label: 'AI requests', group: 'AI', kind: 'sum', unit: 'count', system: true },
  { key: 'ai_failed', label: 'AI requests failed', group: 'AI', kind: 'sum', unit: 'count', system: true },
  { key: 'ai_cost_usd', label: 'AI spend', group: 'AI', kind: 'sum', unit: 'usd', system: true },
  { key: 'ai_unpriced', label: 'AI requests with no price set', group: 'AI', kind: 'sum', unit: 'count', system: true },
  { key: 'midcity_ai_calls', label: 'Midcity AI requests (separate business)', group: 'AI', kind: 'sum', unit: 'count', system: true },
  { key: 'midcity_ai_cost_usd', label: 'Midcity AI spend (separate business)', group: 'AI', kind: 'sum', unit: 'usd', system: true },
  // Systems
  { key: 'cron_runs', label: 'Scheduled job runs', group: 'Systems', kind: 'sum', unit: 'count', system: true },
  { key: 'cron_failed', label: 'Scheduled job runs failed', group: 'Systems', kind: 'sum', unit: 'count', system: true },
  { key: 'cron_partial', label: 'Scheduled job runs partly failed', group: 'Systems', kind: 'sum', unit: 'count', system: true },
  { key: 'errors_logged', label: 'Errors carried on past', group: 'Systems', kind: 'sum', unit: 'count', system: true },
  { key: 'alerts_raised', label: 'Alerts raised', group: 'Systems', kind: 'sum', unit: 'count', system: true },
  { key: 'open_alerts', label: 'Alerts still open', group: 'Systems', kind: 'last', unit: 'count', snapshot: true },
  // Limits
  { key: 'db_bytes', label: 'Database size', group: 'Limits', kind: 'last', unit: 'bytes', snapshot: true },
  { key: 'storage_bytes', label: 'File storage used', group: 'Limits', kind: 'last', unit: 'bytes', snapshot: true },
]

export type DayMetrics = Record<string, number>

type Row = Record<string, unknown>
const PAGE = 1000

/** Every matching row, a page at a time (PostgREST returns at most 1000). */
async function fetchAll(make: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: unknown }> }): Promise<Row[]> {
  const out: Row[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await make().range(offset, offset + PAGE - 1)
    if (error) throw new Error(`health figures: ${(error as { message?: string }).message ?? String(error)}`)
    const rows = (data ?? []) as Row[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

const money = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100

/**
 * Figures for each day from `from` up to (not including) `to`. Snapshot
 * figures are taken now and put on `snapshotDay`, when it's in the range.
 */
export async function computeDays(
  db: SupabaseClient,
  tenantId: string,
  from: string,
  to: string,
  opts: { snapshotDay?: string | null; now?: Date } = {},
): Promise<Record<string, DayMetrics>> {
  const days = daysBetween(from, to)
  const out: Record<string, DayMetrics> = {}
  for (const d of days) {
    out[d] = {}
    for (const m of METRICS) {
      if (m.snapshot) continue
      if (m.system && d < SYSTEM_TRACKING_SINCE) continue
      out[d][m.key] = 0
    }
  }
  const fromIso = dayStartIso(from)
  const toIso = dayStartIso(to)
  const bump = (day: string | null, key: string, by = 1) => {
    if (!day || !out[day] || !(key in out[day])) return
    out[day][key] = Math.round((out[day][key] + by) * 1_000_000) / 1_000_000
  }
  /** Rows of this office with `col` (a timestamp) in the range */
  const timed = (table: string, cols: string, col: string, scope: 'tenant' | 'tenant-or-none' | 'all' = 'tenant') =>
    fetchAll(() => {
      let q = db.from(table).select(cols).gte(col, fromIso).lt(col, toIso)
      if (scope === 'tenant') q = q.eq('tenant_id', tenantId)
      if (scope === 'tenant-or-none') q = q.or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      return q.order(col, { ascending: true })
    })
  const dayOf = (v: unknown) => (typeof v === 'string' && v ? perthDay(v) : null)

  const [orders, jobsNew, jobsDone, comms, inspections, quotes, wos, signSent, signSigned, issued, paid, learning, cards, activity] = await Promise.all([
    timed('insurer_orders', 'created_at', 'created_at'),
    timed('jobs', 'created_at, insurer', 'created_at'),
    timed('jobs', 'completion_approved_at, insurer', 'completion_approved_at'),
    timed('communications', 'created_at, type, direction', 'created_at'),
    timed('inspections', 'form_submitted_at, job_id', 'form_submitted_at'),
    timed('quotes', 'created_at', 'created_at'),
    timed('work_orders', 'created_at', 'created_at'),
    timed('signing_requests', 'sent_at', 'sent_at'),
    timed('signing_requests', 'signed_at', 'signed_at'),
    // Invoice dates are calendar dates already
    fetchAll(() => db.from('invoices').select('issued_date, amount_inc_gst, status, voided_at').eq('tenant_id', tenantId).eq('direction', 'outbound').gte('issued_date', from).lt('issued_date', to).order('issued_date', { ascending: true })),
    fetchAll(() => db.from('invoices').select('paid_date, amount_inc_gst, status, voided_at').eq('tenant_id', tenantId).eq('direction', 'outbound').gte('paid_date', from).lt('paid_date', to).order('paid_date', { ascending: true })),
    timed('learning_events', 'created_at, outcome', 'created_at'),
    timed('action_queue', 'created_at', 'created_at'),
    timed('activity_log', 'created_at, via', 'created_at'),
  ])

  for (const r of orders) bump(dayOf(r.created_at), 'orders_received')
  for (const r of jobsNew) if (!isFieldAppJob(r)) bump(dayOf(r.created_at), 'jobs_created')
  for (const r of jobsDone) if (!isFieldAppJob(r)) bump(dayOf(r.completion_approved_at), 'jobs_completed')
  for (const r of comms) {
    const d = dayOf(r.created_at)
    if (r.type === 'email' && r.direction === 'inbound') bump(d, 'emails_in')
    else if (r.type === 'email' && r.direction === 'outbound') bump(d, 'emails_out')
    else if (r.type === 'portal' && r.direction === 'inbound') bump(d, 'portal_in')
  }
  // Midcity's inspections are on Midcity's jobs
  const midcityJobs = new Set((await fetchAll(() => db.from('jobs').select('id').eq('tenant_id', tenantId).eq('insurer', FIELD_APP_INSURER).order('id'))).map(r => String(r.id)))
  for (const r of inspections) if (!midcityJobs.has(String(r.job_id))) bump(dayOf(r.form_submitted_at), 'inspections_done')
  for (const r of quotes) bump(dayOf(r.created_at), 'quotes_created')
  for (const r of wos) bump(dayOf(r.created_at), 'work_orders_created')
  for (const r of signSent) bump(dayOf(r.sent_at), 'signing_sent')
  for (const r of signSigned) bump(dayOf(r.signed_at), 'signing_signed')
  for (const r of issued) {
    if (r.status === 'voided' || r.voided_at) continue
    bump(String(r.issued_date), 'invoices_issued')
    bump(String(r.issued_date), 'invoiced_aud', money(r.amount_inc_gst))
  }
  for (const r of paid) {
    if (r.status === 'voided' || r.voided_at) continue
    bump(String(r.paid_date), 'payments_received')
    bump(String(r.paid_date), 'paid_aud', money(r.amount_inc_gst))
  }
  const outcomeKey: Record<string, string> = { accepted: 'ai_accepted', edited: 'ai_edited', instructed: 'ai_instructed', skipped: 'ai_skipped' }
  for (const r of learning) if (outcomeKey[String(r.outcome)]) bump(dayOf(r.created_at), outcomeKey[String(r.outcome)])
  for (const r of cards) bump(dayOf(r.created_at), 'action_cards_made')
  for (const r of activity) {
    bump(dayOf(r.created_at), 'staff_actions')
    if (r.via === 'voice') bump(dayOf(r.created_at), 'voice_actions')
  }

  // Insurer deadlines: each one reached in the range counts as met or missed
  const kpis: [string, string][] = [['kpi_contacted_at', 'kpi_contact_due'], ['kpi_booked_at', 'kpi_booking_due'], ['kpi_visited_at', 'kpi_visit_due'], ['kpi_reported_at', 'kpi_report_due']]
  const kpiRows = await Promise.all(kpis.map(([at, due]) => timed('jobs', `${at}, ${due}, insurer`, at)))
  kpis.forEach(([at, due], i) => {
    for (const r of kpiRows[i]) {
      if (!r[due] || isFieldAppJob(r)) continue
      bump(dayOf(r[at]), Date.parse(String(r[at])) <= Date.parse(String(r[due])) ? 'kpi_met' : 'kpi_missed')
    }
  })

  // System figures (§25.1), only from when they were first recorded
  if (to > SYSTEM_TRACKING_SINCE) {
    const [ai, runs, errors, alerts] = await Promise.all([
      timed('ai_calls', 'created_at, ok, cost_usd, model, feature', 'created_at', 'tenant-or-none'),
      timed('cron_runs', 'started_at, status', 'started_at', 'all'),
      timed('system_errors', 'created_at', 'created_at', 'tenant-or-none'),
      timed('health_alerts', 'first_seen_at', 'first_seen_at', 'all'),
    ])
    for (const r of ai) {
      const d = dayOf(r.created_at)
      // Midcity's AI use (features "midcity-…") on its own lines
      if (String(r.feature ?? '').startsWith('midcity-')) {
        bump(d, 'midcity_ai_calls')
        if (r.cost_usd != null) bump(d, 'midcity_ai_cost_usd', Number(r.cost_usd))
        continue
      }
      bump(d, 'ai_calls')
      if (!r.ok) bump(d, 'ai_failed')
      if (r.cost_usd == null) { if (r.ok) bump(d, 'ai_unpriced') } else bump(d, 'ai_cost_usd', Number(r.cost_usd))
    }
    for (const r of runs) {
      const d = dayOf(r.started_at)
      bump(d, 'cron_runs')
      if (r.status === 'failed') bump(d, 'cron_failed')
      if (r.status === 'partial') bump(d, 'cron_partial')
    }
    for (const r of errors) bump(dayOf(r.created_at), 'errors_logged')
    for (const r of alerts) bump(dayOf(r.first_seen_at), 'alerts_raised')
  }

  const snapDay = opts.snapshotDay
  if (snapDay && out[snapDay]) Object.assign(out[snapDay], await snapshot(db, tenantId, opts.now ?? new Date()))

  return out
}

/** Levels right now: open jobs, money owed, open alerts, database and storage size. */
export async function snapshot(db: SupabaseClient, tenantId: string, now: Date): Promise<DayMetrics> {
  const monthAgo = addDays(perthDay(now), -30)
  const [open, owed, alerts, sizes] = await Promise.all([
    db.from('jobs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).is('completion_approved_at', null).is('lapsed_at', null).or(`insurer.is.null,insurer.neq.${FIELD_APP_INSURER}`),
    fetchAll(() => db.from('invoices').select('amount_inc_gst, issued_date').eq('tenant_id', tenantId).eq('direction', 'outbound').eq('status', 'sent').is('paid_date', null).is('voided_at', null).order('issued_date', { ascending: true })),
    db.from('health_alerts').select('id', { count: 'exact', head: true }).is('resolved_at', null),
    db.rpc('health_storage_stats'),
  ])
  const out: DayMetrics = {
    open_jobs: open.count ?? 0,
    owed_aud: money(owed.reduce((s, r) => s + money(r.amount_inc_gst), 0)),
    overdue_aud: money(owed.filter(r => r.issued_date && String(r.issued_date) < monthAgo).reduce((s, r) => s + money(r.amount_inc_gst), 0)),
    open_alerts: alerts.count ?? 0,
  }
  const size = (Array.isArray(sizes.data) ? sizes.data[0] : sizes.data) as { db_bytes?: number | string; storage_bytes?: number | string } | null
  if (size) {
    out.db_bytes = Number(size.db_bytes) || 0
    out.storage_bytes = Number(size.storage_bytes) || 0
  }
  return out
}
