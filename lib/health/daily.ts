import type { SupabaseClient } from '@supabase/supabase-js'
import { METRICS, METRICS_VERSION, computeDays, type DayMetrics, type MetricDef } from './metrics'
import { addDays, daysBetween, perthDay, periodFor, PERIOD_KINDS, type Period, type PeriodKind } from './periods'

// The daily figures (tech spec §25.3): written each night by
// /api/health/daily, read by the admin health panel (/api/health/summary)
// and, later, the weekly write-up and the voice connector.

const SNAPSHOT_KEYS = new Set(METRICS.filter(m => m.snapshot).map(m => m.key))
/** How far back the past is filled in */
const MAX_YEARS_BACK = 5
/** Days worked out per query batch when filling in the past */
const CHUNK_DAYS = 92

interface DailyRow { tenant_id: string; day: string; metrics: DayMetrics; version: number }

async function storedDays(db: SupabaseClient, tenantId: string, from: string, to: string): Promise<DailyRow[]> {
  const out: DailyRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from('health_daily').select('tenant_id, day, metrics, version')
      .eq('tenant_id', tenantId).gte('day', from).lt('day', to).order('day', { ascending: true }).range(offset, offset + 999)
    if (error) throw new Error(`health_daily: ${error.message}`)
    out.push(...((data ?? []) as DailyRow[]))
    if ((data ?? []).length < 1000) return out
  }
}

/** Saves worked-out days, keeping snapshot figures already taken for them (they can't be worked out again). */
async function saveDays(db: SupabaseClient, tenantId: string, days: Record<string, DayMetrics>, existing: DailyRow[]): Promise<number> {
  const before = new Map(existing.map(r => [r.day, r.metrics]))
  const rows = Object.entries(days).map(([day, metrics]) => {
    const kept = Object.fromEntries(Object.entries(before.get(day) ?? {}).filter(([k]) => SNAPSHOT_KEYS.has(k) && !(k in metrics)))
    return { tenant_id: tenantId, day, metrics: { ...kept, ...metrics }, version: METRICS_VERSION, computed_at: new Date().toISOString() }
  })
  if (!rows.length) return 0
  const { error } = await db.from('health_daily').upsert(rows, { onConflict: 'tenant_id,day' })
  if (error) throw new Error(`health_daily: ${error.message}`)
  return rows.length
}

/** The first day there's anything to count, at most MAX_YEARS_BACK ago. */
async function firstDay(db: SupabaseClient, tenantId: string, today: string): Promise<string> {
  const earliest = await Promise.all(['jobs', 'insurer_orders', 'communications'].map(async t => {
    const { data } = await db.from(t).select('created_at').eq('tenant_id', tenantId).order('created_at', { ascending: true }).limit(1)
    const at = (data as { created_at?: string }[] | null)?.[0]?.created_at
    return at ? perthDay(at) : today
  }))
  const floor = `${Number(today.slice(0, 4)) - MAX_YEARS_BACK}${today.slice(4)}`
  const first = earliest.sort()[0]
  return first < floor ? floor : first
}

/** Runs of consecutive days, each at most `max` long. */
function runsOf(days: string[], max: number): [string, string][] {
  const out: [string, string][] = []
  for (const d of days) {
    const last = out[out.length - 1]
    if (last && last[1] === d && daysBetween(last[0], last[1]).length < max) last[1] = addDays(d, 1)
    else out.push([d, addDays(d, 1)])
  }
  return out
}

export interface DailyResult { tenant: string; written: number; backfilled: number; remaining: number }

/**
 * The nightly run: yesterday's figures (with tonight's snapshot of levels),
 * the day before again for records that came in late, then past days still
 * missing or worked out under an older METRICS_VERSION, while time allows.
 */
export async function runDailyFigures(db: SupabaseClient, opts: { now?: Date; budgetMs?: number } = {}): Promise<DailyResult[]> {
  const now = opts.now ?? new Date()
  const started = Date.now()
  const budget = opts.budgetMs ?? 240_000
  const today = perthDay(now)
  const yesterday = addDays(today, -1)
  const { data: tenants } = await db.from('tenants').select('id')
  const results: DailyResult[] = []

  for (const { id: tenantId } of (tenants ?? []) as { id: string }[]) {
    const recent = await storedDays(db, tenantId, addDays(yesterday, -1), today)
    let written = await saveDays(db, tenantId, await computeDays(db, tenantId, addDays(yesterday, -1), today, { snapshotDay: yesterday, now }), recent)

    const first = await firstDay(db, tenantId, today)
    const stored = await storedDays(db, tenantId, first, today)
    const current = new Set(stored.filter(r => r.version >= METRICS_VERSION).map(r => r.day))
    const missing = daysBetween(first, yesterday).filter(d => !current.has(d))
    let backfilled = 0
    // Newest first, so the recent past is there soonest
    for (const [from, to] of runsOf(missing, CHUNK_DAYS).reverse()) {
      if (Date.now() - started > budget) break
      const n = await saveDays(db, tenantId, await computeDays(db, tenantId, from, to), stored.filter(r => r.day >= from && r.day < to))
      backfilled += n
      written += n
    }
    results.push({ tenant: tenantId, written, backfilled, remaining: missing.length - backfilled })
  }
  return results
}

// ── The summary the health panel shows ──────────────────────────────────────

export type Light = 'green' | 'amber' | 'red' | 'grey'

export interface MetricValue {
  key: string
  label: string
  group: MetricDef['group']
  unit: MetricDef['unit']
  /** null: not tracked in this period */
  value: number | null
  /** Tracked for only part of the period */
  partial: boolean
  /** The period before (to the same day, for the current period) */
  previous: number | null
  /** Average of the 4 periods before (to the same day, for the current period) */
  typical: number | null
}

export interface Area { key: string; label: string; light: Light; note: string }

export interface HealthSummary {
  period: Period
  periods: Pick<Period, 'offset' | 'label'>[]
  /** Days of the period counted (to today, for the current period) */
  daysCounted: number
  areas: Area[]
  metrics: MetricValue[]
  alerts: { key: string; severity: string; title: string; detail: string | null; first_seen_at: string; last_seen_at: string }[]
}

/** Adds a run of days up for each figure. */
export function rollup(days: DayMetrics[]): Record<string, { value: number | null; partial: boolean }> {
  const out: Record<string, { value: number | null; partial: boolean }> = {}
  for (const m of METRICS) {
    const having = days.filter(d => typeof d[m.key] === 'number')
    if (!having.length) { out[m.key] = { value: null, partial: false }; continue }
    const value = m.kind === 'last'
      ? having[having.length - 1][m.key]
      : Math.round(having.reduce((s, d) => s + d[m.key], 0) * 100) / 100
    out[m.key] = { value, partial: m.kind === 'sum' && having.length < days.length }
  }
  return out
}

const gb = (bytes: number) => bytes / 1024 ** 3
const fmtGb = (bytes: number) => `${gb(bytes) < 1 ? gb(bytes).toFixed(2) : gb(bytes).toFixed(1)} GB`
const envNumber = (name: string, fallback: number) => {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

export function areasFor(m: Record<string, MetricValue>, alerts: HealthSummary['alerts']): Area[] {
  const v = (k: string) => m[k]?.value ?? null
  const open = (prefix: string, severity?: string) => alerts.some(a => a.key.startsWith(prefix) && (!severity || a.severity === severity))

  // Systems: scheduled jobs and errors
  let systems: Area
  const runs = v('cron_runs')
  if (runs == null) systems = { key: 'systems', label: 'Systems', light: 'grey', note: 'Not tracked in this period' }
  else {
    const failed = v('cron_failed') ?? 0
    const errors = v('errors_logged') ?? 0
    const rate = runs ? failed / runs : 0
    const light: Light = open('cron-', 'critical') ? 'red' : (open('cron-') || open('errors-') || rate > 0.02) ? 'amber' : 'green'
    systems = { key: 'systems', label: 'Systems', light, note: `${failed.toLocaleString()} of ${runs.toLocaleString()} job runs failed · ${errors.toLocaleString()} errors` }
  }

  // AI: failures and spend
  let ai: Area
  const calls = v('ai_calls')
  if (calls == null) ai = { key: 'ai', label: 'AI', light: 'grey', note: 'Not tracked in this period' }
  else {
    const failed = v('ai_failed') ?? 0
    const cost = v('ai_cost_usd') ?? 0
    const unpriced = v('ai_unpriced') ?? 0
    const light: Light = open('ai-failing') ? 'red' : (open('ai-spend') || (calls >= 20 && failed / calls > 0.05) || unpriced > 0) ? 'amber' : 'green'
    ai = { key: 'ai', label: 'AI', light, note: `US$${cost.toFixed(2)} on ${calls.toLocaleString()} requests · ${failed} failed${unpriced ? ` · ${unpriced} with no price set` : ''}` }
  }

  // Limits: database and file storage against the plan
  let limits: Area
  const dbBytes = v('db_bytes')
  if (dbBytes == null) limits = { key: 'limits', label: 'Limits', light: 'grey', note: 'Not measured yet (first reading tonight)' }
  else {
    const dbLimit = envNumber('HEALTH_DB_LIMIT_GB', 8) * 1024 ** 3
    const storeBytes = v('storage_bytes') ?? 0
    const storeLimit = envNumber('HEALTH_STORAGE_LIMIT_GB', 100) * 1024 ** 3
    const worst = Math.max(dbBytes / dbLimit, storeBytes / storeLimit)
    limits = {
      key: 'limits', label: 'Limits',
      light: worst >= 0.9 ? 'red' : worst >= 0.75 ? 'amber' : 'green',
      note: `Database ${fmtGb(dbBytes)} of ${fmtGb(dbLimit)} · files ${fmtGb(storeBytes)} of ${fmtGb(storeLimit)}`,
    }
  }

  const security: Area = { key: 'security', label: 'Security', light: 'grey', note: 'Not checked yet' }

  // Business: how busy, against the usual (no good or bad, so no colour)
  const busyKeys = ['orders_received', 'jobs_created', 'emails_in']
  const now = busyKeys.reduce((s, k) => s + (v(k) ?? 0), 0)
  const usual = busyKeys.reduce((s, k) => s + (m[k]?.typical ?? 0), 0)
  const change = usual ? Math.round(((now - usual) / usual) * 100) : null
  const business: Area = {
    key: 'business', label: 'Business', light: 'grey',
    note: change == null ? `${v('orders_received') ?? 0} orders, ${v('jobs_created') ?? 0} jobs` :
      Math.abs(change) < 10 ? `About as busy as usual (${v('orders_received') ?? 0} orders, ${v('jobs_created') ?? 0} jobs)` :
      `${change > 0 ? 'Busier' : 'Quieter'} than usual (${change > 0 ? '+' : ''}${change}% work in)`,
  }

  return [systems, ai, limits, security, business]
}

/** The panel's figures for one period, against the period before and the usual. */
export async function loadSummary(db: SupabaseClient, tenantId: string, kind: PeriodKind, offset: number, now: Date = new Date()): Promise<HealthSummary> {
  if (!PERIOD_KINDS.includes(kind)) throw new Error(`Unknown period ${kind}`)
  const today = perthDay(now)
  const period = periodFor(kind, offset, now)
  const compare = [1, 2, 3, 4].map(n => periodFor(kind, offset + n, now))
  const rows = await storedDays(db, tenantId, compare[3].from, period.to)
  const byDay = new Map(rows.map(r => [r.day, r.metrics]))

  // Days not yet written by the nightly run (today, and yesterday before it runs) are worked out now
  if (period.to > today) {
    const lastStored = rows.length ? rows[rows.length - 1].day : addDays(today, -1)
    const from = [addDays(lastStored, 1), period.from, addDays(today, -7)].sort()[2]
    if (from <= today) {
      const live = await computeDays(db, tenantId, from, addDays(today, 1), { snapshotDay: today, now })
      for (const [d, metrics] of Object.entries(live)) byDay.set(d, metrics)
    }
  }

  // The current period counts to today; compare like with like (the same number of days)
  const end = period.to > today ? addDays(today, 1) : period.to
  const counted = daysBetween(period.from, end)
  const daysOf = (from: string, to: string, limit?: number) => {
    const ds = daysBetween(from, to).slice(0, limit)
    return ds.map(d => byDay.get(d)).filter((x): x is DayMetrics => !!x)
  }
  const current = rollup(counted.map(d => byDay.get(d)).filter((x): x is DayMetrics => !!x))
  const partialLen = period.to > today ? counted.length : undefined
  const priors = compare.map(p => rollup(daysOf(p.from, p.to, partialLen)))

  const metrics: MetricValue[] = METRICS.map(m => {
    const typicalValues = priors.map(p => p[m.key].value).filter((x): x is number => x != null)
    return {
      key: m.key, label: m.label, group: m.group, unit: m.unit,
      value: current[m.key].value,
      partial: current[m.key].partial,
      previous: priors[0][m.key].value,
      typical: m.kind === 'sum' && typicalValues.length ? Math.round((typicalValues.reduce((s, x) => s + x, 0) / typicalValues.length) * 100) / 100 : null,
    }
  })

  const { data: alertRows } = await db.from('health_alerts').select('key, severity, title, detail, first_seen_at, last_seen_at').is('resolved_at', null).order('first_seen_at', { ascending: false })
  const alerts = (alertRows ?? []) as HealthSummary['alerts']

  return {
    period,
    periods: [0, 1, 2, 3, 4].map(n => ({ offset: n, label: periodFor(kind, n, now).label })),
    daysCounted: counted.length,
    areas: areasFor(Object.fromEntries(metrics.map(x => [x.key, x])), alerts),
    metrics,
    alerts,
  }
}
