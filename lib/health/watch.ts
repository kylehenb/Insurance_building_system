import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { getGmailClient } from '@/lib/gmail/client'
import { buildEmailRaw } from '@/lib/email/build-raw'
import { scheduledJobs, type ScheduledJob } from './schedule'
import { logError } from './errors'

// The health watcher (tech spec §25), a cron every 10 minutes. It doesn't
// wait for the weekly check for things that need someone now:
//
//   - a scheduled job has stopped running (two runs missed)
//   - a scheduled job keeps failing (3 in a row; 1 for daily jobs), or ran
//     past its time limit and never finished
//   - an AI provider is failing (half or more of 5+ calls in the last hour)
//   - errors the app carried on past are spiking (HEALTH_ERROR_SPIKE an hour, default 25)
//   - AI spend in the last 24 hours is over HEALTH_AI_DAILY_ALERT_USD (default $25)
//
// Each problem is one open health_alerts row: emailed when it first appears
// and once a day while it lasts, closed (with a "cleared" email) when it
// stops. Emails go to HEALTH_ALERT_EMAIL (comma-separated) or else every
// admin. It also lets go of old cron_runs (60 days) and system_errors (a year).

const HOUR = 60 * 60 * 1000
const MIN = 60 * 1000
/** A run still 'running' after this is taken to have timed out or crashed (Vercel's limit is 300s). */
const STUCK_AFTER_MS = 20 * MIN
const RENOTIFY_MS = 24 * HOUR
const OFFICE_EMAIL = 'office@insurancerepairco.com.au'

export type Severity = 'warning' | 'critical'

export interface Finding {
  key: string
  severity: Severity
  title: string
  detail: string
}

export interface CronRunRow { route: string; started_at: string; status: string; error: string | null }
export interface AiCallRow { provider: string; ok: boolean; error: string | null }
export interface ErrorRow { source: string }

export interface WatchData {
  now: Date
  jobs: ScheduledJob[]
  /** Earliest cron_runs row: before monitoring began, a job can't be called overdue */
  monitoringSince: Date | null
  /** Latest runs per route, newest first */
  runs: Record<string, CronRunRow[]>
  aiLastHour: AiCallRow[]
  errorsLastHour: ErrorRow[]
  aiSpendLast24h: number
}

const envNumber = (name: string, fallback: number) => {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

function ago(from: Date, to: Date): string {
  const mins = Math.round((to.getTime() - from.getTime()) / MIN)
  if (mins < 120) return `${mins} minutes`
  const hours = Math.round(mins / 60)
  return hours < 48 ? `${hours} hours` : `${Math.round(hours / 24)} days`
}

/** What's wrong right now, from the data the watcher loaded. */
export function findProblems(d: WatchData): Finding[] {
  const out: Finding[] = []

  for (const job of d.jobs) {
    const runs = d.runs[job.route] ?? []
    const last = runs[0]
    const lastStart = last ? new Date(last.started_at) : d.monitoringSince
    if (lastStart && d.now.getTime() - lastStart.getTime() > job.overdueAfterMinutes * MIN) {
      out.push({
        key: `cron-overdue:${job.route}`,
        severity: 'critical',
        title: `Scheduled job ${job.route} has stopped running`,
        detail: last
          ? `It should run every ${job.intervalMinutes >= 60 ? `${job.intervalMinutes / 60} hours` : `${job.intervalMinutes} minutes`} (${job.schedule}) but last started ${ago(lastStart, d.now)} ago.`
          : `It should run on ${job.schedule} but hasn't run since monitoring began ${ago(lastStart, d.now)} ago.`,
      })
      continue
    }
    const finished = runs.filter(r => r.status !== 'running')
    const needed = job.intervalMinutes >= 24 * 60 ? 1 : 3
    const streak = finished.slice(0, needed)
    if (streak.length === needed && streak.every(r => r.status === 'failed')) {
      out.push({
        key: `cron-failing:${job.route}`,
        severity: 'critical',
        title: `Scheduled job ${job.route} is failing`,
        detail: `${needed === 1 ? 'Its last run failed' : `Its last ${needed} runs failed`}: ${streak[0].error ?? 'no error message'}`,
      })
    }
  }

  const byProvider = new Map<string, AiCallRow[]>()
  for (const c of d.aiLastHour) byProvider.set(c.provider, [...(byProvider.get(c.provider) ?? []), c])
  for (const [provider, calls] of byProvider) {
    const failed = calls.filter(c => !c.ok)
    if (calls.length >= 5 && failed.length / calls.length >= 0.5) {
      out.push({
        key: `ai-failing:${provider}`,
        severity: 'critical',
        title: `AI requests to ${provider} are failing`,
        detail: `${failed.length} of ${calls.length} in the last hour failed. Latest: ${failed[0]?.error ?? 'no error message'}`,
      })
    }
  }

  const spike = envNumber('HEALTH_ERROR_SPIKE', 25)
  if (d.errorsLastHour.length >= spike) {
    const counts = new Map<string, number>()
    for (const e of d.errorsLastHour) counts.set(e.source, (counts.get(e.source) ?? 0) + 1)
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, n]) => `${s} (${n})`).join(', ')
    out.push({
      key: 'errors-spike',
      severity: 'warning',
      title: 'Errors are spiking',
      detail: `${d.errorsLastHour.length} errors in the last hour. Most from: ${top}.`,
    })
  }

  const spendCap = envNumber('HEALTH_AI_DAILY_ALERT_USD', 25)
  if (d.aiSpendLast24h >= spendCap) {
    out.push({
      key: 'ai-spend-high',
      severity: 'warning',
      title: 'AI spend is unusually high',
      detail: `US$${d.aiSpendLast24h.toFixed(2)} in the last 24 hours (alert level US$${spendCap.toFixed(2)}).`,
    })
  }

  return out
}

export interface OpenAlert {
  id: string
  key: string
  title: string
  notified_at: string | null
  occurrences: number
}

export interface AlertPlan {
  open: Finding[]
  still: { alert: OpenAlert; finding: Finding }[]
  resolve: OpenAlert[]
  /** New alerts, ones never emailed, and ones last emailed a day or more ago */
  notify: Finding[]
  /** Cleared alerts someone was told about */
  cleared: OpenAlert[]
}

export function planAlerts(openAlerts: OpenAlert[], findings: Finding[], now: Date): AlertPlan {
  const byKey = new Map(openAlerts.map(a => [a.key, a]))
  const keys = new Set(findings.map(f => f.key))
  const plan: AlertPlan = { open: [], still: [], resolve: [], notify: [], cleared: [] }
  for (const f of findings) {
    const alert = byKey.get(f.key)
    if (!alert) {
      plan.open.push(f)
      plan.notify.push(f)
      continue
    }
    plan.still.push({ alert, finding: f })
    if (!alert.notified_at || now.getTime() - new Date(alert.notified_at).getTime() >= RENOTIFY_MS) plan.notify.push(f)
  }
  for (const a of openAlerts) {
    if (keys.has(a.key)) continue
    plan.resolve.push(a)
    if (a.notified_at) plan.cleared.push(a)
  }
  return plan
}

export function alertEmail(notify: Finding[], cleared: OpenAlert[]): { subject: string; body: string } {
  const critical = notify.some(f => f.severity === 'critical')
  const subject = notify.length
    ? `${critical ? 'Action needed' : 'Heads up'}: ${notify.length === 1 ? notify[0].title : `${notify.length} system health problems`}`
    : `Cleared: ${cleared.length === 1 ? cleared[0].title : `${cleared.length} system health problems`}`
  const lines: string[] = []
  if (notify.length) {
    lines.push('The IRC Master health watcher found:', '')
    for (const f of notify) lines.push(`${f.severity === 'critical' ? '[CRITICAL]' : '[WARNING]'} ${f.title}`, `  ${f.detail}`, '')
  }
  if (cleared.length) {
    lines.push('Cleared since the last email:', '')
    for (const a of cleared) lines.push(`- ${a.title}`)
    lines.push('')
  }
  lines.push('(Automated message from the health watcher. You get one email when a problem starts, a reminder each day it lasts, and one when it clears.)')
  return { subject, body: lines.join('\n') }
}

async function alertRecipients(db: SupabaseClient): Promise<string[]> {
  const configured = (process.env.HEALTH_ALERT_EMAIL ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (configured.length) return configured
  const { data } = await db.from('users').select('id').eq('role', 'admin')
  const service = createServiceClient()
  const emails: string[] = []
  for (const u of (data ?? []) as { id: string }[]) {
    const { data: auth } = await service.auth.admin.getUserById(u.id)
    if (auth?.user?.email) emails.push(auth.user.email)
  }
  return emails.length ? emails : [OFFICE_EMAIL]
}

export type Notifier = (to: string[], subject: string, body: string) => Promise<void>

const gmailNotifier: Notifier = async (to, subject, body) => {
  await getGmailClient().users.messages.send({
    userId: 'me',
    requestBody: { raw: buildEmailRaw({ from: OFFICE_EMAIL, to: to.join(', '), subject, body }) },
  })
}

async function loadWatchData(db: SupabaseClient, now: Date): Promise<WatchData> {
  const jobs = scheduledJobs()
  const hourAgo = new Date(now.getTime() - HOUR).toISOString()
  const dayAgo = new Date(now.getTime() - 24 * HOUR).toISOString()

  // A run still open past the time limit timed out or crashed: close it as failed
  await db.from('cron_runs')
    .update({ status: 'failed', finished_at: now.toISOString(), error: 'Never finished (timed out or crashed)' })
    .eq('status', 'running')
    .lt('started_at', new Date(now.getTime() - STUCK_AFTER_MS).toISOString())

  const [first, ai, errors, spend, ...perRoute] = await Promise.all([
    db.from('cron_runs').select('started_at').order('started_at', { ascending: true }).limit(1),
    db.from('ai_calls').select('provider, ok, error').gte('created_at', hourAgo).order('created_at', { ascending: false }).limit(2000),
    db.from('system_errors').select('source').gte('created_at', hourAgo).limit(2000),
    db.from('ai_calls').select('cost_usd').gte('created_at', dayAgo).limit(50000),
    ...jobs.map(j => db.from('cron_runs').select('route, started_at, status, error').eq('route', j.route).order('started_at', { ascending: false }).limit(5)),
  ])

  const firstRow = (first.data as { started_at: string }[] | null)?.[0]
  return {
    now,
    jobs,
    monitoringSince: firstRow ? new Date(firstRow.started_at) : null,
    runs: Object.fromEntries(jobs.map((j, i) => [j.route, (perRoute[i].data ?? []) as CronRunRow[]])),
    aiLastHour: (ai.data ?? []) as AiCallRow[],
    errorsLastHour: (errors.data ?? []) as ErrorRow[],
    aiSpendLast24h: ((spend.data ?? []) as { cost_usd: number | string | null }[]).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0),
  }
}

export interface WatchResult {
  problems: string[]
  opened: number
  resolved: number
  emailed: boolean
}

export async function runHealthWatch(db: SupabaseClient, opts: { now?: Date; notify?: Notifier } = {}): Promise<WatchResult> {
  const now = opts.now ?? new Date()
  const findings = findProblems(await loadWatchData(db, now))

  const { data: openRows } = await db.from('health_alerts').select('id, key, title, notified_at, occurrences').is('resolved_at', null)
  const plan = planAlerts((openRows ?? []) as OpenAlert[], findings, now)
  const iso = now.toISOString()

  if (plan.open.length) {
    await db.from('health_alerts').insert(plan.open.map(f => ({ key: f.key, severity: f.severity, title: f.title, detail: f.detail, first_seen_at: iso, last_seen_at: iso, occurrences: 1 })))
  }
  for (const { alert, finding } of plan.still) {
    await db.from('health_alerts').update({
      severity: finding.severity, title: finding.title, detail: finding.detail, last_seen_at: iso, occurrences: alert.occurrences + 1,
    }).eq('id', alert.id)
  }
  if (plan.resolve.length) {
    await db.from('health_alerts').update({ resolved_at: iso }).in('id', plan.resolve.map(a => a.id))
  }

  let emailed = false
  if (plan.notify.length || plan.cleared.length) {
    try {
      const { subject, body } = alertEmail(plan.notify, plan.cleared)
      await (opts.notify ?? gmailNotifier)(await alertRecipients(db), subject, body)
      emailed = true
      if (plan.notify.length) {
        await db.from('health_alerts').update({ notified_at: iso }).is('resolved_at', null).in('key', plan.notify.map(f => f.key))
      }
    } catch (err) {
      // Left un-notified, so the next run tries again
      await logError('health-watch:email', err)
    }
  }

  // Let go of old records (the daily figures in part 2 will keep the totals)
  await db.from('cron_runs').delete().lt('started_at', new Date(now.getTime() - 60 * 24 * HOUR).toISOString())
  await db.from('system_errors').delete().lt('created_at', new Date(now.getTime() - 365 * 24 * HOUR).toISOString())

  return { problems: findings.map(f => f.title), opened: plan.open.length, resolved: plan.resolve.length, emailed }
}
