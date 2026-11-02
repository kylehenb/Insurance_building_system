import { describe, it, expect, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { perthDay, periodFor, dayStartIso, daysBetween } from '../periods'
import { computeDays, METRICS, METRICS_VERSION } from '../metrics'
import { runDailyFigures, loadSummary, rollup, areasFor, type MetricValue } from '../daily'

// The health check's daily figures (tech spec §25.3): worked out per Perth
// day from dated records, kept nightly with a reading of levels, filled in
// for the past, and rolled up into weeks, months, quarters and years against
// the period before and the usual.

// Wed 4 Nov 2026, 10am Perth
const NOW = new Date('2026-11-04T02:00:00Z')

describe('periods (Perth time)', () => {
  it('puts an instant on its Perth day', () => {
    expect(perthDay('2026-11-03T15:59:00Z')).toBe('2026-11-03')
    expect(perthDay('2026-11-03T16:00:00Z')).toBe('2026-11-04')
    expect(dayStartIso('2026-11-04')).toBe('2026-11-03T16:00:00.000Z')
  })

  it('weeks run Monday to Sunday', () => {
    expect(periodFor('week', 0, NOW)).toMatchObject({ from: '2026-11-02', to: '2026-11-09', label: 'This week' })
    expect(periodFor('week', 1, NOW)).toMatchObject({ from: '2026-10-26', to: '2026-11-02', label: 'Last week' })
    expect(periodFor('week', 4, NOW).label).toBe('Week of 5 Oct')
  })

  it('months, quarters and years, across year ends', () => {
    expect(periodFor('month', 0, NOW)).toMatchObject({ from: '2026-11-01', to: '2026-12-01' })
    expect(periodFor('month', 11, NOW)).toMatchObject({ from: '2025-12-01', to: '2026-01-01', label: 'Dec 2025' })
    expect(periodFor('quarter', 0, NOW)).toMatchObject({ from: '2026-10-01', to: '2027-01-01' })
    expect(periodFor('quarter', 4, NOW)).toMatchObject({ from: '2025-10-01', label: 'Q4 2025' })
    expect(periodFor('year', 2, NOW)).toMatchObject({ from: '2024-01-01', to: '2025-01-01', label: '2024' })
  })
})

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables) as never

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.tenants = [{ id: 't1' }]
  tables.jobs = [
    // 2 Nov Perth (j2 at 11:59pm Perth), 3 Nov, and another office's
    { id: 'j1', tenant_id: 't1', created_at: '2026-11-02T01:00:00Z', completion_approved_at: null, lapsed_at: null, kpi_contacted_at: '2026-11-02T03:00:00Z', kpi_contact_due: '2026-11-02T05:00:00Z' },
    { id: 'j2', tenant_id: 't1', created_at: '2026-11-02T15:59:00Z', completion_approved_at: null, lapsed_at: null, kpi_booked_at: '2026-11-03T03:00:00Z', kpi_booking_due: '2026-11-02T05:00:00Z' },
    { id: 'j3', tenant_id: 't1', created_at: '2026-11-03T02:00:00Z', completion_approved_at: '2026-11-03T06:00:00Z', lapsed_at: null },
    { id: 'jx', tenant_id: 't2', created_at: '2026-11-02T02:00:00Z', completion_approved_at: null, lapsed_at: null },
    { id: 'j0', tenant_id: 't1', created_at: '2026-10-20T02:00:00Z', completion_approved_at: null, lapsed_at: null },
  ]
  tables.insurer_orders = [{ tenant_id: 't1', created_at: '2026-11-02T01:00:00Z' }]
  tables.communications = [
    { tenant_id: 't1', created_at: '2026-11-02T02:00:00Z', type: 'email', direction: 'inbound' },
    { tenant_id: 't1', created_at: '2026-11-02T03:00:00Z', type: 'email', direction: 'outbound' },
    { tenant_id: 't1', created_at: '2026-11-03T03:00:00Z', type: 'portal', direction: 'inbound' },
    { tenant_id: 't1', created_at: '2026-11-03T03:00:00Z', type: 'note', direction: null },
  ]
  tables.invoices = [
    { tenant_id: 't1', direction: 'outbound', status: 'sent', issued_date: '2026-11-03', paid_date: null, amount_inc_gst: 1100, voided_at: null },
    { tenant_id: 't1', direction: 'outbound', status: 'sent', issued_date: '2026-09-01', paid_date: null, amount_inc_gst: 550.5, voided_at: null },
    { tenant_id: 't1', direction: 'outbound', status: 'voided', issued_date: '2026-11-03', paid_date: null, amount_inc_gst: 999, voided_at: '2026-11-03T05:00:00Z' },
    { tenant_id: 't1', direction: 'outbound', status: 'paid', issued_date: '2026-10-01', paid_date: '2026-11-02', amount_inc_gst: 220, voided_at: null },
  ]
  tables.learning_events = [
    { tenant_id: 't1', created_at: '2026-11-03T01:00:00Z', outcome: 'accepted' },
    { tenant_id: 't1', created_at: '2026-11-03T02:00:00Z', outcome: 'edited' },
  ]
  tables.activity_log = [{ tenant_id: 't1', created_at: '2026-11-03T01:00:00Z', via: 'voice' }, { tenant_id: 't1', created_at: '2026-11-03T01:00:00Z', via: 'app' }]
  tables.ai_calls = [
    { tenant_id: 't1', created_at: '2026-11-03T01:00:00Z', ok: true, cost_usd: 0.25, model: 'claude-haiku-5-5' },
    { tenant_id: null, created_at: '2026-11-03T01:00:00Z', ok: false, cost_usd: null, model: 'gemini-3.5-flash' },
    { tenant_id: 't2', created_at: '2026-11-03T01:00:00Z', ok: true, cost_usd: 9, model: 'claude-haiku-5-5' },
    // Before tracking began: not counted
    { tenant_id: 't1', created_at: '2026-11-02T01:00:00Z', ok: true, cost_usd: 1, model: 'claude-haiku-5-5' },
  ]
  tables.cron_runs = [{ started_at: '2026-11-03T01:00:00Z', status: 'failed' }, { started_at: '2026-11-03T01:02:00Z', status: 'ok' }]
  tables.health_alerts = [{ key: 'cron-failing:/api/gmail/poll', severity: 'critical', title: 'Poll is failing', detail: 'x', first_seen_at: '2026-11-03T01:05:00Z', last_seen_at: '2026-11-03T01:05:00Z', resolved_at: null }]
  tables['rpc:health_storage_stats'] = [{ db_bytes: 2 * 1024 ** 3, storage_bytes: 10 * 1024 ** 3 }] as never
})

describe('a day\'s figures', () => {
  it('counts each record on its Perth day, for this office only', async () => {
    const days = await computeDays(db, 't1', '2026-11-02', '2026-11-04')
    expect(days['2026-11-02']).toMatchObject({ jobs_created: 2, orders_received: 1, emails_in: 1, emails_out: 1, paid_aud: 220, payments_received: 1, kpi_met: 1 })
    expect(days['2026-11-03']).toMatchObject({
      jobs_created: 1, jobs_completed: 1, portal_in: 1, invoices_issued: 1, invoiced_aud: 1100, kpi_missed: 1,
      ai_accepted: 1, ai_edited: 1, staff_actions: 2, voice_actions: 1,
      ai_calls: 2, ai_failed: 1, ai_cost_usd: 0.25, ai_unpriced: 0, cron_runs: 2, cron_failed: 1, alerts_raised: 1,
    })
  })

  it('leaves system figures out before they were recorded, rather than calling them zero', async () => {
    const days = await computeDays(db, 't1', '2026-11-02', '2026-11-03')
    expect(days['2026-11-02']).not.toHaveProperty('ai_calls')
    expect(days['2026-11-02']).toHaveProperty('jobs_created')
  })

  it('takes a reading of levels on the snapshot day', async () => {
    const days = await computeDays(db, 't1', '2026-11-03', '2026-11-04', { snapshotDay: '2026-11-03', now: NOW })
    expect(days['2026-11-03']).toMatchObject({ open_jobs: 3, owed_aud: 1650.5, overdue_aud: 550.5, open_alerts: 1, db_bytes: 2 * 1024 ** 3, storage_bytes: 10 * 1024 ** 3 })
  })
})

describe('the nightly run', () => {
  it('writes yesterday with its reading, and fills in the past back to the first record', async () => {
    const [r] = await runDailyFigures(db, { now: NOW })
    const byDay = new Map(tables.health_daily.map(x => [x.day as string, x]))
    expect(byDay.get('2026-11-03')).toMatchObject({ version: METRICS_VERSION, metrics: expect.objectContaining({ jobs_created: 1, open_jobs: 3 }) })
    // First record is 20 Oct (job j0); every day from then to yesterday is there
    expect(daysBetween('2026-10-20', '2026-11-04').every(d => byDay.has(d))).toBe(true)
    expect(byDay.has('2026-10-19')).toBe(false)
    expect(r.remaining).toBe(0)
  })

  it("keeps an earlier night's reading when the day is worked out again", async () => {
    tables.health_daily = [{ tenant_id: 't1', day: '2026-11-02', version: METRICS_VERSION, metrics: { open_jobs: 7, jobs_created: 0 } }]
    await runDailyFigures(db, { now: NOW })
    expect(tables.health_daily.find(x => x.day === '2026-11-02')?.metrics).toMatchObject({ open_jobs: 7, jobs_created: 2 })
  })
})

describe('rolling up', () => {
  it('adds days up, takes the latest level, and says when a figure was only tracked part of the time', () => {
    const r = rollup([{ jobs_created: 2, open_jobs: 5 }, { jobs_created: 3, ai_calls: 4, open_jobs: 6 }])
    expect(r.jobs_created).toEqual({ value: 5, partial: false })
    expect(r.open_jobs).toEqual({ value: 6, partial: false })
    expect(r.ai_calls).toEqual({ value: 4, partial: true })
    expect(r.db_bytes).toEqual({ value: null, partial: false })
  })

  it('lights each area', () => {
    const m = (key: string, value: number | null, typical: number | null = null) => [key, { key, value, typical } as MetricValue] as const
    const areas = areasFor(Object.fromEntries([
      m('cron_runs', 1000), m('cron_failed', 1), m('errors_logged', 3),
      m('ai_calls', 100), m('ai_failed', 10), m('ai_cost_usd', 4.5), m('ai_unpriced', 0),
      m('db_bytes', 7 * 1024 ** 3), m('storage_bytes', 1024 ** 3),
      m('orders_received', 13, 10), m('jobs_created', 12, 10), m('emails_in', 100, 80),
    ]), [{ key: 'cron-failing:/x', severity: 'critical', title: '', detail: null, first_seen_at: '', last_seen_at: '' }])
    const by = Object.fromEntries(areas.map(a => [a.key, a]))
    expect(by.systems).toMatchObject({ light: 'red', note: '1 of 1,000 job runs failed · 3 errors' })
    expect(by.ai).toMatchObject({ light: 'amber' }) // 10% failed
    expect(by.limits).toMatchObject({ light: 'amber' }) // 7 of 8 GB
    expect(by.security.light).toBe('grey')
    expect(by.business.note).toBe('Busier than usual (+25% work in)')
  })
})

describe('the summary', () => {
  it('this week to date, against the same days of earlier weeks, with live figures for days not yet written', async () => {
    // Last week's Monday and Tuesday were written already
    tables.health_daily = [
      { tenant_id: 't1', day: '2026-10-26', version: 1, metrics: { jobs_created: 4 } },
      { tenant_id: 't1', day: '2026-10-27', version: 1, metrics: { jobs_created: 2 } },
      { tenant_id: 't1', day: '2026-10-28', version: 1, metrics: { jobs_created: 1 } },
      { tenant_id: 't1', day: '2026-10-30', version: 1, metrics: { jobs_created: 50 } },
    ]
    const s = await loadSummary(db, 't1', 'week', 0, NOW)
    expect(s.period.label).toBe('This week')
    expect(s.daysCounted).toBe(3) // Mon to Wed
    const jobs = s.metrics.find(m => m.key === 'jobs_created')!
    expect(jobs.value).toBe(3) // worked out live: 2 on Mon, 1 on Tue
    expect(jobs.previous).toBe(7) // last Mon to Wed only, not Friday's 50
    expect(s.alerts).toHaveLength(1)
    expect(s.periods.map(p => p.label)).toEqual(['This week', 'Last week', 'Week of 19 Oct', 'Week of 12 Oct', 'Week of 5 Oct'])
    expect(s.metrics.map(m => m.key)).toEqual(METRICS.map(m => m.key))
  })

  it('a past month from what was written', async () => {
    tables.health_daily = [
      { tenant_id: 't1', day: '2026-10-05', version: 1, metrics: { jobs_created: 4, open_jobs: 20 } },
      { tenant_id: 't1', day: '2026-10-25', version: 1, metrics: { jobs_created: 6, open_jobs: 25 } },
      { tenant_id: 't1', day: '2026-09-10', version: 1, metrics: { jobs_created: 5 } },
    ]
    const s = await loadSummary(db, 't1', 'month', 1, NOW)
    expect(s.period).toMatchObject({ from: '2026-10-01', label: 'Oct 2026' })
    const by = Object.fromEntries(s.metrics.map(m => [m.key, m]))
    expect(by.jobs_created).toMatchObject({ value: 10, previous: 5, typical: 5 })
    expect(by.open_jobs.value).toBe(25)
  })
})
