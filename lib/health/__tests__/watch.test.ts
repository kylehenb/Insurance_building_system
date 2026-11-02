import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { intervalMinutes, overdueAfterMinutes, scheduledJobs } from '../schedule'
import { findProblems, planAlerts, alertEmail, runHealthWatch, type WatchData, type OpenAlert } from '../watch'

// The health watcher (tech spec §25): a job that stopped or keeps failing, AI
// failing, error spikes and high AI spend are emailed once when they start,
// daily while they last, and once when they clear.

const NOW = new Date('2026-11-02T02:00:00Z')
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

describe('schedules', () => {
  it('reads how often each job runs', () => {
    expect(intervalMinutes('* * * * *')).toBe(1)
    expect(intervalMinutes('*/2 * * * *')).toBe(2)
    expect(intervalMinutes('*/15 * * * *')).toBe(15)
    expect(intervalMinutes('0 */4 * * *')).toBe(240)
    expect(intervalMinutes('13 18 * * *')).toBe(1440)
  })

  it('calls a job overdue after two missed runs, never under 15 minutes', () => {
    expect(overdueAfterMinutes('* * * * *')).toBe(15)
    expect(overdueAfterMinutes('*/10 * * * *')).toBe(20)
    expect(overdueAfterMinutes('0 6 * * *')).toBe(2 * 1440 + 120)
  })

  it('covers every cron in vercel.json, each recorded with withCronRun', () => {
    const crons = (JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string }[] }).crons
    expect(scheduledJobs().map(j => j.route)).toEqual(crons.map(c => c.path))
    for (const { path } of crons) {
      expect(readFileSync(`app${path}/route.ts`, 'utf8'), path).toContain(`withCronRun('${path}'`)
    }
  })
})

function data(over: Partial<WatchData> = {}): WatchData {
  return {
    now: NOW,
    jobs: [
      { route: '/api/gmail/poll', schedule: '*/2 * * * *', intervalMinutes: 2, overdueAfterMinutes: 15 },
      { route: '/api/jobs/review', schedule: '37 22 * * *', intervalMinutes: 1440, overdueAfterMinutes: 3000 },
    ],
    monitoringSince: new Date(minsAgo(60 * 24 * 3)),
    runs: {
      '/api/gmail/poll': [{ route: '/api/gmail/poll', started_at: minsAgo(1), status: 'ok', error: null }],
      '/api/jobs/review': [{ route: '/api/jobs/review', started_at: minsAgo(200), status: 'ok', error: null }],
    },
    aiLastHour: [],
    errorsLastHour: [],
    aiSpendLast24h: 1.2,
    ...over,
  }
}

describe('finding problems', () => {
  it('finds nothing when all is well', () => {
    expect(findProblems(data())).toEqual([])
  })

  it('a job that has stopped running', () => {
    const d = data({ runs: { ...data().runs, '/api/gmail/poll': [{ route: '/api/gmail/poll', started_at: minsAgo(40), status: 'ok', error: null }] } })
    expect(findProblems(d)).toMatchObject([{ key: 'cron-overdue:/api/gmail/poll', severity: 'critical' }])
  })

  it("a job that has never run, but only once monitoring's been on long enough", () => {
    expect(findProblems(data({ runs: { '/api/jobs/review': data().runs['/api/jobs/review'] } }))[0].key).toBe('cron-overdue:/api/gmail/poll')
    expect(findProblems(data({ runs: { '/api/jobs/review': data().runs['/api/jobs/review'] }, monitoringSince: new Date(minsAgo(5)) }))).toEqual([])
  })

  it('a frequent job failing 3 times running; a daily job failing once', () => {
    const fail = (route: string, m: number) => ({ route, started_at: minsAgo(m), status: 'failed', error: 'invalid_grant' })
    const twice = data({ runs: { ...data().runs, '/api/gmail/poll': [fail('/api/gmail/poll', 1), fail('/api/gmail/poll', 3), { route: '/api/gmail/poll', started_at: minsAgo(5), status: 'ok', error: null }] } })
    expect(findProblems(twice)).toEqual([])
    const thrice = data({ runs: { ...data().runs, '/api/gmail/poll': [fail('/api/gmail/poll', 1), fail('/api/gmail/poll', 3), fail('/api/gmail/poll', 5)] } })
    expect(findProblems(thrice)).toMatchObject([{ key: 'cron-failing:/api/gmail/poll', detail: 'Its last 3 runs failed: invalid_grant' }])
    const daily = data({ runs: { ...data().runs, '/api/jobs/review': [fail('/api/jobs/review', 200)] } })
    expect(findProblems(daily)).toMatchObject([{ key: 'cron-failing:/api/jobs/review' }])
  })

  it('an AI provider failing half its calls (with enough calls to tell)', () => {
    const calls = (ok: number, bad: number) => [
      ...Array.from({ length: bad }, () => ({ provider: 'google', ok: false, error: '503' })),
      ...Array.from({ length: ok }, () => ({ provider: 'google', ok: true, error: null })),
    ]
    expect(findProblems(data({ aiLastHour: calls(0, 4) }))).toEqual([])
    expect(findProblems(data({ aiLastHour: calls(3, 3) }))).toMatchObject([{ key: 'ai-failing:google', detail: '3 of 6 in the last hour failed. Latest: 503' }])
    expect(findProblems(data({ aiLastHour: calls(8, 2) }))).toEqual([])
  })

  it('an error spike, naming where they came from', () => {
    const errorsLastHour = [...Array(20).fill({ source: 'ai-parse:photo-labels' }), ...Array(5).fill({ source: 'order-parser:prompt' })]
    expect(findProblems(data({ errorsLastHour }))).toMatchObject([{ key: 'errors-spike', detail: '25 errors in the last hour. Most from: ai-parse:photo-labels (20), order-parser:prompt (5).' }])
  })

  it('high AI spend', () => {
    expect(findProblems(data({ aiSpendLast24h: 31.5 }))).toMatchObject([{ key: 'ai-spend-high', severity: 'warning' }])
  })
})

describe('alerts', () => {
  const f = (key: string) => ({ key, severity: 'critical' as const, title: `Problem ${key}`, detail: 'd' })
  const open = (key: string, notifiedMinsAgo: number | null): OpenAlert => ({ id: `a-${key}`, key, title: `Problem ${key}`, notified_at: notifiedMinsAgo == null ? null : minsAgo(notifiedMinsAgo), occurrences: 3 })

  it('opens new problems, keeps lasting ones, closes cleared ones', () => {
    const plan = planAlerts([open('a', 30), open('b', 30)], [f('a'), f('c')], NOW)
    expect(plan.open.map(x => x.key)).toEqual(['c'])
    expect(plan.still.map(x => x.alert.key)).toEqual(['a'])
    expect(plan.resolve.map(x => x.key)).toEqual(['b'])
    expect(plan.notify.map(x => x.key)).toEqual(['c']) // 'a' was emailed half an hour ago
    expect(plan.cleared.map(x => x.key)).toEqual(['b'])
  })

  it('reminds daily, and retries ones never emailed', () => {
    const plan = planAlerts([open('a', 25 * 60), open('b', null)], [f('a'), f('b')], NOW)
    expect(plan.notify.map(x => x.key)).toEqual(['a', 'b'])
  })

  it('writes one email for everything', () => {
    const { subject, body } = alertEmail([f('a')], [open('b', 10)])
    expect(subject).toBe('Action needed: Problem a')
    expect(body).toContain('[CRITICAL] Problem a')
    expect(body).toContain('Cleared since the last email:\n\n- Problem b')
    expect(alertEmail([], [open('b', 10)]).subject).toBe('Cleared: Problem b')
  })
})

describe('a watcher run', () => {
  const tables: Record<string, Row[]> = {}
  const db = fakeSupabase(tables) as never

  beforeEach(() => {
    for (const k of Object.keys(tables)) delete tables[k]
    process.env.HEALTH_ALERT_EMAIL = 'kyle@example.com'
    // Every job ran a minute ago, except the poller, which has failed three times
    tables.cron_runs = scheduledJobs().filter(j => j.route !== '/api/gmail/poll').map(j => ({ route: j.route, started_at: minsAgo(1), status: 'ok', error: null }))
    for (const m of [3, 5, 7]) tables.cron_runs.push({ route: '/api/gmail/poll', started_at: minsAgo(m), status: 'failed', error: 'invalid_grant' })
    // A run that never finished
    tables.cron_runs.push({ route: '/api/signing/reminders', started_at: minsAgo(45), status: 'running', error: null })
    tables.cron_runs.push({ route: '/api/old', started_at: minsAgo(61 * 24 * 60), status: 'ok', error: null })
  })

  it('emails a new problem once, then not again until it clears', async () => {
    const notify = vi.fn(async () => {})
    const first = await runHealthWatch(db, { now: NOW, notify })
    expect(first).toMatchObject({ opened: 1, emailed: true, problems: ['Scheduled job /api/gmail/poll is failing'] })
    expect(notify).toHaveBeenCalledWith(['kyle@example.com'], 'Action needed: Scheduled job /api/gmail/poll is failing', expect.stringContaining('invalid_grant'))
    expect(tables.health_alerts[0]).toMatchObject({ key: 'cron-failing:/api/gmail/poll', notified_at: NOW.toISOString() })

    // The stuck run is closed as failed; records over 60 days old are let go
    expect(tables.cron_runs.find(r => r.route === '/api/signing/reminders' && r.started_at === minsAgo(45))).toMatchObject({ status: 'failed' })
    expect(tables.cron_runs.some(r => r.route === '/api/old')).toBe(false)

    notify.mockClear()
    const later = new Date(NOW.getTime() + 10 * 60_000)
    expect(await runHealthWatch(db, { now: later, notify })).toMatchObject({ opened: 0, emailed: false })
    expect(tables.health_alerts[0].occurrences).toBe(2)

    // It recovers
    tables.cron_runs.push({ route: '/api/gmail/poll', started_at: later.toISOString(), status: 'ok', error: null })
    expect(await runHealthWatch(db, { now: later, notify })).toMatchObject({ resolved: 1, emailed: true })
    expect(notify).toHaveBeenCalledWith(['kyle@example.com'], 'Cleared: Scheduled job /api/gmail/poll is failing', expect.any(String))
    expect(tables.health_alerts[0].resolved_at).toBe(later.toISOString())
  })

  it('keeps an alert un-emailed when the email fails, so the next run tries again', async () => {
    await runHealthWatch(db, { now: NOW, notify: async () => { throw new Error('Gmail down') } })
    expect(tables.health_alerts[0].notified_at ?? null).toBeNull()
  })
})
