import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// Requested services: created at lodge, then done in-house (draft report and
// invoice at the client's rates) or by a trade (work order; then the report
// and an invoice at the trade's cost plus margin), switchable until the
// report goes, and done once the report and its invoice have been sent.

vi.mock('@/lib/jobs/recomputeStage', () => ({ recomputeAndSaveStage: async () => {} }))
const voided: string[] = []
vi.mock('@/lib/invoices/void', () => ({
  voidInvoice: async (db: { from: (t: string) => { update: (p: Row) => { eq: (c: string, v: unknown) => { eq: (c: string, v: unknown) => Promise<unknown> } } } }, tenantId: string, id: string) => {
    voided.push(id)
    await db.from('invoices').update({ status: 'voided' }).eq('tenant_id', tenantId).eq('id', id)
  },
}))

const {
  createServicesForOrder, arrangeInHouse, arrangeTrade, prepareTradeReport, markServiceNotNeeded, addService,
  refreshJobServices, loadJobServices, loadOpenServices, parseServiceAction, onChargeAmounts,
} = await import('../services')
const { serviceStage } = await import('../service-stage')

let db: Record<string, Row[]>
let supabase: never
const T = 't1'

beforeEach(() => {
  voided.length = 0
  db = {
    jobs: [{ id: 'j1', tenant_id: T, job_number: 'IRC1001', property_address: '1 Main St', insured_name: 'Pat', claim_number: 'CLM1', loss_type: null, client_id: 'c1', property_details: null, insurer: 'Castle' }],
    clients: [{ id: 'c1', tenant_id: T, make_safe_amount: 350, leak_detection_report_amount: 600, single_storey_roof_report_amount: 450, builders_margin_pct: 20 }],
    invoice_templates: [
      { tenant_id: T, template_code: 'make_safe', is_active: true, description: 'Make safe at {property_address}' },
      { tenant_id: T, template_code: 'single_storey_roof', is_active: true, description: 'Roof report at {property_address}' },
    ],
    // The BAR's invoice from lodging: the next one must not reuse its number
    invoices: [{ id: 'inv-bar', tenant_id: T, job_id: 'j1', invoice_ref: 'INV-IRC1001-1', status: 'draft', direction: 'outbound' }],
    reports: [{ id: 'r-bar', tenant_id: T, job_id: 'j1', report_ref: 'BAR-IRC1001-1', report_type: 'BAR', status: 'draft' }],
    invoice_line_items: [],
    work_orders: [],
    work_order_visits: [],
    trades: [{ id: 'tr1', tenant_id: T, business_name: 'Sparky Bros' }],
    job_services: [],
  }
  supabase = fakeSupabase(db) as never
})

async function lodgedMakeSafe() {
  const [s] = await createServicesForOrder(supabase, { tenantId: T, jobId: 'j1', orderId: 'o1', types: ['make_safe', 'BAR', 'quote_only'] })
  return s
}
const service = (id: string) => db.job_services.find(s => s.id === id)!
const stageOf = async (id: string) => (await loadJobServices(supabase, T, 'j1', { includeClosed: true })).find(v => v.service.id === id)!.stage

describe('lodging', () => {
  it('makes one service per make safe / roof report / leak detection / specialist type — not for the BAR or a quote — and not twice', async () => {
    const created = await createServicesForOrder(supabase, { tenantId: T, jobId: 'j1', orderId: 'o1', types: ['make_safe', 'BAR', 'roof_report', 'quote_only'] })
    expect(created.map(s => [s.service_type, s.status])).toEqual([['make_safe', 'unassigned'], ['roof_report', 'unassigned']])
    expect(await createServicesForOrder(supabase, { tenantId: T, jobId: 'j1', orderId: 'o2', types: ['make_safe', 'leak_detection'] }))
      .toEqual([expect.objectContaining({ service_type: 'leak_detection' })])
  })

  it('an unarranged make safe is urgent', async () => {
    const s = await lodgedMakeSafe()
    expect(await stageOf(s.id)).toMatchObject({ key: 'unassigned', urgent: true, open: true })
  })
})

describe('in-house', () => {
  it('makes the draft report and an invoice at the client\'s rate, numbered after the job\'s others', async () => {
    const s = await lodgedMakeSafe()
    const res = await arrangeInHouse(supabase, T, s.id, { userId: 'u1' })
    expect(db.reports.at(-1)).toMatchObject({ report_type: 'make_safe', report_ref: 'MS-IRC1001-1', status: 'draft' })
    expect(db.invoices.at(-1)).toMatchObject({ invoice_ref: 'INV-IRC1001-2', invoice_type: 'make_safe', amount_ex_gst: 350, report_id: db.reports.at(-1)!.id })
    expect(service(s.id)).toMatchObject({ status: 'in_house', report_id: db.reports.at(-1)!.id, invoice_id: db.invoices.at(-1)!.id, assigned_by: 'u1' })
    expect(res.message).toBe('Make Safe on IRC1001 is being done in-house: draft report MS-IRC1001-1 and invoice INV-IRC1001-2 created.')
    expect(await stageOf(s.id)).toMatchObject({ key: 'to_send', urgent: false })
  })
})

describe('trade', () => {
  it('makes a make safe work order, and switching from in-house removes the draft report and voids its invoice', async () => {
    const s = await lodgedMakeSafe()
    await arrangeInHouse(supabase, T, s.id)
    const msReport = service(s.id).report_id as string
    const msInvoice = service(s.id).invoice_id as string
    const res = await arrangeTrade(supabase, T, s.id, { tradeId: 'tr1' })
    expect(db.reports.find(r => r.id === msReport)!.deleted_at).toBeTruthy()
    expect(voided).toEqual([msInvoice])
    expect(db.work_orders).toEqual([expect.objectContaining({ job_id: 'j1', trade_name: 'Make Safe', work_type: 'make_safe', trade_id: 'tr1', status: 'pending' })])
    expect(service(s.id)).toMatchObject({ status: 'trade', work_order_id: db.work_orders[0].id, report_id: null, invoice_id: null })
    expect(res.warnings).toEqual([])
    expect(await stageOf(s.id)).toMatchObject({ key: 'wo_unsent', urgent: true, text: 'Work order not sent yet (Sparky Bros)' })
    db.work_orders[0].gary_state = 'sending'
    expect(await stageOf(s.id)).toMatchObject({ key: 'with_trade', urgent: false, text: 'With Sparky Bros' })
  })

  it('back to in-house: an unsent work order is removed; a sent one stays and the office is told to let the trade know', async () => {
    const s = await lodgedMakeSafe()
    await arrangeTrade(supabase, T, s.id)
    await arrangeInHouse(supabase, T, s.id)
    expect(db.work_orders).toEqual([])

    const s2 = (await createServicesForOrder(supabase, { tenantId: T, jobId: 'j1', orderId: null, types: ['roof_report'] }))[0]
    await arrangeTrade(supabase, T, s2.id)
    db.work_orders[0].gary_state = 'confirmed'
    const res = await arrangeInHouse(supabase, T, s2.id)
    expect(db.work_orders).toHaveLength(1)
    expect(res.warnings[0]).toMatch(/already gone to the trade — let them know/)
  })

  it('once the trade is done: the report and an invoice at their cost plus the client\'s margin', async () => {
    const s = await lodgedMakeSafe()
    await arrangeTrade(supabase, T, s.id, { tradeId: 'tr1' })
    const woId = db.work_orders[0].id
    db.work_orders[0].status = 'works_complete'
    expect(await stageOf(s.id)).toMatchObject({ key: 'trade_done' })
    db.invoices.push({ id: 'bill1', tenant_id: T, job_id: 'j1', work_order_id: woId, direction: 'inbound', status: 'approved', amount_ex_gst: 400 })

    const res = await prepareTradeReport(supabase, T, s.id)
    const inv = db.invoices.at(-1)!
    expect(inv).toMatchObject({ invoice_ref: 'INV-IRC1001-2', direction: 'outbound', invoice_type: 'make_safe', work_order_id: woId, amount_ex_gst: 480, gst: 48, amount_inc_gst: 528, markup_pct: 0.2, status: 'draft' })
    expect(db.invoice_line_items.at(-1)).toMatchObject({ invoice_id: inv.id, unit_price: 400, line_total: 400, description: 'Make Safe — 1 Main St (claim CLM1)' })
    expect(db.reports.at(-1)).toMatchObject({ report_ref: 'MS-IRC1001-1', report_type: 'make_safe' })
    expect(res.message).toContain('$528.00 inc GST ($400.00 from the trade\'s invoice plus 20% margin)')
    expect(await stageOf(s.id)).toMatchObject({ key: 'to_send' })
  })

  it('asks for the trade\'s cost when it isn\'t on record, and uses the one given', async () => {
    const s = await lodgedMakeSafe()
    await arrangeTrade(supabase, T, s.id)
    await expect(prepareTradeReport(supabase, T, s.id)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/cost isn't known/) })
    await prepareTradeReport(supabase, T, s.id, { costOverride: 250 })
    expect(db.invoices.at(-1)).toMatchObject({ amount_ex_gst: 300, amount_inc_gst: 330 })
    expect(db.work_orders[0].trade_cost).toBe(250)
  })

  it('works out the on-charge with no margin set', () => {
    expect(onChargeAmounts(333.33, 0)).toEqual({ markup: 0, exGst: 333.33, gst: 33.33, incGst: 366.66 })
  })
})

describe('done, and what can\'t change', () => {
  it('is done once the report and its invoice have gone; a report sent without its invoice stays open', async () => {
    const s = await lodgedMakeSafe()
    await arrangeInHouse(supabase, T, s.id)
    const report = db.reports.find(r => r.id === service(s.id).report_id)!
    const invoice = db.invoices.find(i => i.id === service(s.id).invoice_id)!
    report.status = 'sent'
    await refreshJobServices(supabase, T, 'j1')
    expect(service(s.id).status).toBe('in_house')
    expect(await stageOf(s.id)).toMatchObject({ key: 'invoice_outstanding', text: 'Report sent — invoice INV-IRC1001-2 still to send' })
    invoice.status = 'sent'
    await refreshJobServices(supabase, T, 'j1')
    expect(service(s.id)).toMatchObject({ status: 'done', closed_at: expect.any(String) })
    expect(await loadJobServices(supabase, T, 'j1')).toEqual([])
  })

  it('can\'t switch once the report has gone', async () => {
    const s = await lodgedMakeSafe()
    await arrangeInHouse(supabase, T, s.id)
    db.reports.find(r => r.id === service(s.id).report_id)!.status = 'sent'
    await expect(arrangeTrade(supabase, T, s.id)).rejects.toMatchObject({ status: 409 })
  })

  it('not needed: closes it with the reason and tidies what was set up', async () => {
    const s = await lodgedMakeSafe()
    await arrangeTrade(supabase, T, s.id)
    await markServiceNotNeeded(supabase, T, s.id, { reason: 'Insurer cancelled' })
    expect(service(s.id)).toMatchObject({ status: 'cancelled', notes: 'Insurer cancelled', work_order_id: null })
    expect(db.work_orders).toEqual([])
    expect(await stageOf(s.id)).toMatchObject({ key: 'cancelled', text: 'Not needed — Insurer cancelled', open: false })
    await expect(arrangeInHouse(supabase, T, s.id)).rejects.toMatchObject({ status: 409 })
  })

  it('adds one the order didn\'t ask for, but not a second open one', async () => {
    await addService(supabase, T, 'j1', 'leak_detection')
    await expect(addService(supabase, T, 'j1', 'leak_detection')).rejects.toMatchObject({ status: 409 })
    await expect(addService(supabase, T, 'j1', 'BAR')).rejects.toMatchObject({ status: 400 })
  })
})

describe('the open list', () => {
  it('lists open services across jobs, unarranged make safes first, leaving out Midcity\'s', async () => {
    db.jobs.push({ id: 'j2', tenant_id: T, job_number: 'IRC1002', insurer: 'Allianz' }, { id: 'j3', tenant_id: T, job_number: 'MC1', insurer: 'Midcity' })
    await createServicesForOrder(supabase, { tenantId: T, jobId: 'j2', orderId: null, types: ['roof_report'] })
    await createServicesForOrder(supabase, { tenantId: T, jobId: 'j1', orderId: null, types: ['make_safe'] })
    await createServicesForOrder(supabase, { tenantId: T, jobId: 'j3', orderId: null, types: ['make_safe'] })
    const open = await loadOpenServices(supabase, T)
    expect(open.map(v => [v.job.job_number, v.label])).toEqual([['IRC1001', 'Make Safe'], ['IRC1002', 'Roof Report']])
  })
})

describe('parseServiceAction', () => {
  const id = '11111111-1111-1111-1111-111111111111'
  it('reads each action and refuses bad ones', () => {
    expect(parseServiceAction({ action: 'trade', serviceId: id, tradeId: 'nope' }, 'j1')).toEqual({ kind: 'trade', serviceId: id, tradeId: null })
    expect(parseServiceAction({ action: 'prepare', serviceId: id, cost: 120 }, 'j1')).toEqual({ kind: 'prepare', serviceId: id, cost: 120 })
    expect(parseServiceAction({ action: 'add', type: 'roof_report' }, 'j1')).toEqual({ kind: 'add', jobId: 'j1', type: 'roof_report' })
    expect(() => parseServiceAction({ action: 'not_needed', serviceId: id, reason: '' }, 'j1')).toThrow(/why/)
    expect(() => parseServiceAction({ action: 'in_house', serviceId: 'x' }, 'j1')).toThrow(/not found/)
    expect(() => parseServiceAction({ action: 'explode' }, 'j1')).toThrow(/action must be/)
  })
})

describe('serviceStage', () => {
  const base = { id: 's', job_id: 'j', service_type: 'roof_report', status: 'in_house', work_order_id: null, report_id: 'r', invoice_id: 'i', notes: null, created_at: '' }
  it('reads the report and invoice: no invoice, to send, invoice outstanding, done', () => {
    expect(serviceStage({ service: base, workOrder: null, report: { id: 'r', ref: 'RR-1', status: 'draft' }, invoice: null }).key).toBe('no_invoice')
    expect(serviceStage({ service: base, workOrder: null, report: { id: 'r', ref: 'RR-1', status: 'draft' }, invoice: { id: 'i', ref: 'INV-1', status: 'voided' } }).key).toBe('no_invoice')
    expect(serviceStage({ service: base, workOrder: null, report: { id: 'r', ref: 'RR-1', status: 'sent' }, invoice: { id: 'i', ref: 'INV-1', status: 'sent' } }).key).toBe('done')
    expect(serviceStage({ service: base, workOrder: null, report: { id: 'r', ref: 'RR-1', status: 'sent' }, invoice: null }).text).toBe('Report sent — no invoice yet, raise and send it')
  })
})
