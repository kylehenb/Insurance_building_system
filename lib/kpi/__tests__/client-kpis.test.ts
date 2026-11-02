import { describe, it, expect, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { parseTimeConfig } from '@/lib/scheduling/business-hours'
import { applyChangedKpis, DEFAULT_KPIS, kpiDueDates, kpisFor } from '../client-kpis'

// Insurer KPIs: each insurer's own times (the Clients page; defaults for
// anything unset) set a job's due dates from when its order arrived, and a
// change to an insurer's KPIs is carried onto its jobs still to meet one.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables) as never

// Thu 29 Oct 2026, 10am in Perth
const THU = new Date('2026-10-29T02:00:00Z')
const config = parseTimeConfig({ timezone: 'Australia/Perth' })

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.automation_config = [{ tenant_id: 't1', key: 'timezone', value: 'Australia/Perth' }]
})

describe('an insurer\'s KPIs', () => {
  it('uses the insurer\'s own times, the defaults standing in for anything unset', () => {
    expect(kpisFor({ kpi_contact_hours: '4', kpi_booking_hours: 48, kpi_visit_days: null, kpi_report_days: 0 })).toEqual({ contact_hours: 4, booking_hours: 48, visit_days: 2, report_days: 4 })
    expect(kpisFor(null)).toEqual(DEFAULT_KPIS)
  })

  it('counts hours on the clock and days as business days from the order arriving', () => {
    const due = kpiDueDates(config, THU, { contact_hours: 2, booking_hours: 24, visit_days: 2, report_days: 4 })
    expect(due.kpi_contact_due).toBe('2026-10-29T04:00:00.000Z')
    expect(due.kpi_booking_due).toBe('2026-10-30T02:00:00.000Z')
    expect(due.kpi_visit_due).toBe('2026-11-02T09:30:00.000Z') // Mon 2 Nov, by the end of the office day
    expect(due.kpi_report_due).toBe('2026-11-04T09:30:00.000Z') // Wed 4 Nov
  })
})

describe('changing an insurer\'s KPIs', () => {
  it('moves the due dates of its jobs still to meet a KPI, once', async () => {
    tables.clients = [
      { id: 'castle', tenant_id: 't1', kpi_contact_hours: 2, kpi_booking_hours: 24, kpi_visit_days: 2, kpi_report_days: 2, kpi_updated_at: '2026-11-02T01:00:00Z', kpi_applied_at: null },
      { id: 'allianz', tenant_id: 't1', kpi_report_days: 10, kpi_updated_at: '2026-11-01T00:00:00Z', kpi_applied_at: '2026-11-01T00:00:00Z' },
    ]
    tables.jobs = [
      { id: 'j1', tenant_id: 't1', client_id: 'castle', kpi_contact_due: 'x', kpi_report_due: 'old', kpi_started_at: THU.toISOString(), kpi_contacted_at: 'y', kpi_booked_at: null, kpi_visited_at: null, kpi_reported_at: null },
      { id: 'j2', tenant_id: 't1', client_id: 'castle', kpi_contact_due: 'x', kpi_report_due: 'done', kpi_started_at: THU.toISOString(), kpi_contacted_at: 'a', kpi_booked_at: 'b', kpi_visited_at: 'c', kpi_reported_at: 'd' },
      { id: 'j3', tenant_id: 't1', client_id: 'allianz', kpi_contact_due: 'x', kpi_report_due: 'untouched', kpi_started_at: THU.toISOString() },
    ]
    expect(await applyChangedKpis(db)).toBe(1)
    expect(tables.jobs.map(j => j.kpi_report_due)).toEqual(['2026-11-02T09:30:00.000Z', 'done', 'untouched'])
    expect(tables.clients[0].kpi_applied_at).toBe('2026-11-02T01:00:00Z')
    expect(await applyChangedKpis(db)).toBe(0)
  })
})
