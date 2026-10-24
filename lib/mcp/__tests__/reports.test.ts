import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from './fake-supabase'

// Report tools: reading one, creating one with its invoice (as New report
// does), writing fields or an AI draft from dictated notes (as "AI Generate"
// does), and locking.

const invoiceForReport = vi.fn(async (..._a: unknown[]) => ({ invoiceId: 'inv1', invoiceRef: 'INV-IRC1001-1' }))
vi.mock('@/lib/invoices/report-to-invoice', () => ({ createInvoiceForReport: (...a: unknown[]) => invoiceForReport(...a) }))
const draft = vi.fn(async (..._a: unknown[]) => ({ cause_of_damage: 'Storm-driven rain through a cracked ridge cap.', conclusion: 'Storm damage.', made_up_key: 'ignored' }))
vi.mock('@/lib/reports/generate', () => ({
  ReportGenerateError: class extends Error {},
  generateReportDraft: (...a: unknown[]) => draft(...a),
}))

const { getReport, createReportTool, updateReportTool } = await import('../tools/reports')

const db: Record<string, Row[]> = {}
const ctx = { supabase: fakeSupabase(db) as never, tenantId: 't1', userId: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(db)) delete db[k]
  db.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001', property_details: { storeys: '2' }, property_address: '1 Test St', claim_number: 'CLM1' }]
  db.reports = [
    { id: 'r1', tenant_id: 't1', job_id: 'j1', report_ref: 'BAR-IRC1001-1', report_type: 'BAR', status: 'draft', is_locked: false, deleted_at: null, person_met: 'Mrs Smith', conclusion: null, raw_report_notes: null, type_specific_fields: { roof_pitch: '22' }, created_at: '2026-10-01T00:00:00Z' },
    { id: 'r2', tenant_id: 't1', job_id: 'j1', report_ref: 'RR-IRC1001-2', report_type: 'roof', status: 'sent', is_locked: true, deleted_at: null, created_at: '2026-10-02T00:00:00Z' },
  ]
})

describe('get_report', () => {
  it('reads the written fields and says what is still empty', async () => {
    const res = await getReport.run({ report_id: 'r1' }, ctx)
    expect(res.text).toMatch(/^BAR-IRC1001-1 on IRC1001 \(BAR\): draft, unlocked/)
    expect(res.text).toContain('Person met: Mrs Smith')
    expect(res.text).toMatch(/Still empty: .*Conclusion/)
  })
})

describe('create_report', () => {
  it('creates the next report with its invoice and writes the AI draft from the notes', async () => {
    const res = await createReportTool.run({ job_number: 'IRC1001', report_type: 'make_safe', raw_notes: 'ridge cap cracked, water in ceiling', generate_from_notes: true }, ctx)
    expect(res.isError).toBeFalsy()
    const created = db.reports.find(r => r.report_ref === 'MS-IRC1001-3')!
    expect(created).toMatchObject({ report_type: 'make_safe', status: 'draft', raw_report_notes: 'ridge cap cracked, water in ceiling', cause_of_damage: 'Storm-driven rain through a cracked ridge cap.', conclusion: 'Storm damage.' })
    expect(created).not.toHaveProperty('made_up_key')
    expect(invoiceForReport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reportId: created.id, reportType: 'make_safe', propertyType: 'double_storey' }))
    expect(draft).toHaveBeenCalledWith(expect.objectContaining({ reportType: 'make_safe', rawReportDump: 'ridge cap cracked, water in ceiling', reportId: created.id }))
    expect(res.text).toContain('Raised its invoice INV-IRC1001-1.')
  })
})

describe('update_report', () => {
  it('sets fields and then locks', async () => {
    await updateReportTool.run({ report_id: 'r1', fields: { conclusion: 'Consistent with storm.' }, lock: true }, ctx)
    expect(db.reports[0]).toMatchObject({ conclusion: 'Consistent with storm.', is_locked: true })
  })

  it('refuses to write a locked report unless it unlocks first', async () => {
    const refused = await updateReportTool.run({ report_id: 'r2', fields: { conclusion: 'x' } }, ctx)
    expect(refused).toMatchObject({ isError: true, text: 'RR-IRC1001-2 is locked — unlock it first to change it.' })
    await updateReportTool.run({ report_id: 'r2', lock: false, fields: { conclusion: 'Revised.' } }, ctx)
    expect(db.reports[1]).toMatchObject({ is_locked: false, conclusion: 'Revised.' })
  })
})
