import type { SupabaseClient } from '@supabase/supabase-js'
import { addDelay, parseTimeConfig, type TimeConfig } from '@/lib/scheduling/business-hours'

// Insurer KPIs (migration 20261120_client_kpis.sql): each insurer's contact /
// booking / visit / report times, kept on the insurer itself (clients.kpi_*,
// the Clients page — a new insurer starts at the defaults), set a job's due
// dates, counted from when the insurer's order arrived (jobs.kpi_started_at).
// When an insurer's KPIs change, the minute cron re-applies them to its open
// jobs (applyChangedKpis). When each milestone happened is recorded by the
// database triggers in the migration, however it's saved.

export type ClientKpis = { contact_hours: number; booking_hours: number; visit_days: number; report_days: number }

/** For an insurer with nothing set — and the database's defaults for a new one */
export const DEFAULT_KPIS: ClientKpis = { contact_hours: 2, booking_hours: 24, visit_days: 2, report_days: 4 }

type KpiColumns = { kpi_contact_hours?: number | string | null; kpi_booking_hours?: number | string | null; kpi_visit_days?: number | string | null; kpi_report_days?: number | string | null }

const num = (v: unknown, fallback: number) => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** An insurer's KPIs, the defaults standing in for anything unset */
export function kpisFor(client: KpiColumns | null | undefined): ClientKpis {
  return {
    contact_hours: num(client?.kpi_contact_hours, DEFAULT_KPIS.contact_hours),
    booking_hours: num(client?.kpi_booking_hours, DEFAULT_KPIS.booking_hours),
    visit_days: num(client?.kpi_visit_days, DEFAULT_KPIS.visit_days),
    report_days: num(client?.kpi_report_days, DEFAULT_KPIS.report_days),
  }
}

export type KpiDueDates = { kpi_contact_due: string; kpi_booking_due: string; kpi_visit_due: string; kpi_report_due: string }

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** That many business days on, by the end of that office day ("report within 4 days": by close of the 4th) */
function byEndOfBusinessDay(config: TimeConfig, startedAt: Date, days: number): Date {
  const dayStart = addDelay(config, startedAt, Math.ceil(days), 'business_days')
  return new Date(dayStart.getTime() + (minutesOf(config.business_hours_end) - minutesOf(config.business_hours_start)) * 60_000)
}

/** The due dates from the clock starting: hours on the clock, days as business days (part days round up) */
export function kpiDueDates(config: TimeConfig, startedAt: Date, kpis: ClientKpis): KpiDueDates {
  return {
    kpi_contact_due: addDelay(config, startedAt, kpis.contact_hours, 'hours').toISOString(),
    kpi_booking_due: addDelay(config, startedAt, kpis.booking_hours, 'hours').toISOString(),
    kpi_visit_due: byEndOfBusinessDay(config, startedAt, kpis.visit_days).toISOString(),
    kpi_report_due: byEndOfBusinessDay(config, startedAt, kpis.report_days).toISOString(),
  }
}

/** The company's business hours and holidays (automation_config) */
export async function loadTimeConfig(db: SupabaseClient, tenantId: string): Promise<TimeConfig> {
  const { data, error } = await db.from('automation_config').select('key, value').eq('tenant_id', tenantId)
  if (error) throw new Error(`Failed to load automation config: ${error.message}`)
  const raw: Record<string, string> = {}
  for (const row of (data as { key: string; value: string }[] | null) ?? []) raw[row.key] = row.value
  return parseTimeConfig(raw)
}

/** An insurer's KPIs by id (the defaults when there's no insurer) */
export async function loadClientKpis(db: SupabaseClient, tenantId: string, clientId: string | null): Promise<ClientKpis> {
  if (!clientId) return { ...DEFAULT_KPIS }
  const { data } = await db.from('clients').select('kpi_contact_hours, kpi_booking_hours, kpi_visit_days, kpi_report_days')
    .eq('tenant_id', tenantId).eq('id', clientId).maybeSingle()
  return kpisFor(data as KpiColumns | null)
}

type JobRow = { id: string; kpi_started_at: string | null; created_at: string | null; kpi_contacted_at: string | null; kpi_booked_at: string | null; kpi_visited_at: string | null; kpi_reported_at: string | null }
type ClientRow = KpiColumns & { id: string; tenant_id: string; kpi_updated_at: string | null; kpi_applied_at: string | null }

/**
 * Insurers whose KPIs changed since they were last applied: their jobs
 * with a milestone still to meet get new due dates. Run by the minute cron,
 * so a change on the Clients page shows on its jobs within the minute.
 * Returns the number of jobs changed.
 */
export async function applyChangedKpis(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.from('clients')
    .select('id, tenant_id, kpi_contact_hours, kpi_booking_hours, kpi_visit_days, kpi_report_days, kpi_updated_at, kpi_applied_at')
    .not('kpi_updated_at', 'is', null)
  if (error) throw new Error(error.message)
  const changed = ((data as ClientRow[] | null) ?? []).filter(c => !c.kpi_applied_at || c.kpi_applied_at < c.kpi_updated_at!)
  let jobs = 0
  const configs = new Map<string, TimeConfig>()
  for (const client of changed) {
    if (!configs.has(client.tenant_id)) configs.set(client.tenant_id, await loadTimeConfig(db, client.tenant_id))
    jobs += await applyClientKpis(db, client, configs.get(client.tenant_id)!)
    await db.from('clients').update({ kpi_applied_at: client.kpi_updated_at }).eq('id', client.id)
  }
  return jobs
}

/** One insurer's KPIs onto its jobs that still have a milestone to meet */
async function applyClientKpis(db: SupabaseClient, client: ClientRow, config: TimeConfig): Promise<number> {
  const { data } = await db.from('jobs')
    .select('id, kpi_started_at, created_at, kpi_contacted_at, kpi_booked_at, kpi_visited_at, kpi_reported_at')
    .eq('tenant_id', client.tenant_id).eq('client_id', client.id).not('kpi_contact_due', 'is', null)
  const kpis = kpisFor(client)
  let n = 0
  for (const job of (data as JobRow[] | null) ?? []) {
    if (job.kpi_contacted_at && job.kpi_booked_at && job.kpi_visited_at && job.kpi_reported_at) continue
    const started = job.kpi_started_at ?? job.created_at
    if (!started) continue
    await db.from('jobs').update(kpiDueDates(config, new Date(started), kpis)).eq('id', job.id)
    n++
  }
  return n
}
