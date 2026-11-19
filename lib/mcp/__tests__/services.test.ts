import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from './fake-supabase'

// Requested services by voice: listing them, arranging one in-house or with a
// trade (by contractor name), not needed, adding one, and the trade's report
// and invoice — the same functions as the job page's panel. And the voice
// layer's check that sending a report without its invoice needs its own
// permission.

vi.mock('@/lib/jobs/recomputeStage', () => ({ recomputeAndSaveStage: async () => {} }))
vi.mock('@/lib/invoices/void', () => ({ voidInvoice: async () => ({}) }))
const levels: Record<string, string> = {}
vi.mock('@/lib/permissions/resolve', () => ({
  permissionLevel: async (_t: string, _u: string, key: string) => levels[key] ?? 'allowed',
  refusalMessage: (key: string) => `Not allowed: ${key}`,
}))
const approvals: Row[] = []
vi.mock('@/lib/approvals/service', () => ({
  requestApproval: async (r: Row) => { approvals.push(r); return { id: 'a1', message: 'Waiting for approval.', summary: 's' } },
}))
vi.mock('@/lib/activity/log', () => ({ recordVoiceCall: async () => {}, recordActivity: async () => {}, recordOperation: async () => {} }))

const { listRequestedServices, arrangeService, prepareServiceInvoice } = await import('../tools/services')
const { callTool } = await import('../server')
const { sendDocuments } = await import('../tools/documents')

let db: Record<string, Row[]>
let ctx: { supabase: never; tenantId: string; userId: string }
const T = 't1'

beforeEach(() => {
  approvals.length = 0
  for (const k of Object.keys(levels)) delete levels[k]
  db = {
    jobs: [{ id: 'j1', tenant_id: T, job_number: 'IRC1001', property_address: '1 Main St', insured_name: 'Pat', claim_number: 'CLM1', client_id: 'c1', insurer: 'Castle' }],
    clients: [{ id: 'c1', tenant_id: T, builders_margin_pct: 10 }],
    invoice_templates: [{ tenant_id: T, template_code: 'make_safe', is_active: true, description: 'Make safe' }],
    invoices: [], reports: [], invoice_line_items: [], work_orders: [], work_order_visits: [],
    trades: [{ id: 'tr1', tenant_id: T, business_name: 'Sparky Bros', primary_contact: 'Sam', primary_trade: 'Electrician' }],
    job_services: [{ id: 's1', tenant_id: T, job_id: 'j1', service_type: 'make_safe', status: 'unassigned', work_order_id: null, report_id: null, invoice_id: null, notes: null, created_at: '2026-09-01T00:00:00Z' }],
  }
  ctx = { supabase: fakeSupabase(db) as never, tenantId: T, userId: 'u1' }
})

describe('list_requested_services', () => {
  it('lists every open one, and a job\'s', async () => {
    expect((await listRequestedServices.run({}, ctx)).text).toBe('1 open:\n- IRC1001 Make Safe: Not yet arranged — do it in-house or send it to a trade (urgent)')
    expect((await listRequestedServices.run({ job_number: 'irc1001' }, ctx)).text).toBe('IRC1001:\n- Make Safe: Not yet arranged — do it in-house or send it to a trade (urgent)')
  })
})

describe('arrange_service', () => {
  it('sends it to a trade by contractor name, then the trade\'s report and invoice at cost plus margin', async () => {
    const res = await arrangeService.run({ job_number: 'IRC1001', service: 'make_safe', how: 'trade', contractor: 'sparky' }, ctx)
    expect(res.text).toBe('Make Safe on IRC1001 goes to a trade: work order created and send it from the Work Orders tab.')
    expect(db.work_orders[0]).toMatchObject({ trade_id: 'tr1', work_type: 'make_safe' })
    const prep = await prepareServiceInvoice.run({ job_number: 'IRC1001', service: 'make safe', cost: 200 }, ctx)
    expect(prep.text).toContain('$242.00 inc GST ($200.00 from the amount given plus 10% margin)')
  })

  it('does it in-house, marks one not needed only with a reason, and adds one', async () => {
    expect((await arrangeService.run({ job_number: 'IRC1001', service: 'make_safe', how: 'not_needed' }, ctx)).text).toBe('Why isn\'t it needed?')
    const res = await arrangeService.run({ job_number: 'IRC1001', service: 'make_safe', how: 'in_house' }, ctx)
    expect(res.text).toMatch(/^Make Safe on IRC1001 is being done in-house: draft report MS-IRC1001-1 and invoice INV-IRC1001-1 created\./)
    expect((await arrangeService.run({ job_number: 'IRC1001', service: 'roof_report', how: 'add' }, ctx)).text).toBe('Roof Report added, not yet arranged.')
    expect((await arrangeService.run({ job_number: 'IRC1001', service: 'leak_detection', how: 'in_house' }, ctx)).text)
      .toBe('IRC1001 has no open leak detection. Open: Make Safe, Roof Report. Use arrange_service with how "add" to add one.')
  })

  it('needs services.manage — queued for approval when the user needs it', async () => {
    levels['services.manage'] = 'approval'
    const res = await callTool(arrangeService, { job_number: 'IRC1001', service: 'make_safe', how: 'in_house' }, ctx)
    expect(res.data).toMatchObject({ pending_approval: true })
    expect(approvals[0]).toMatchObject({ action: 'services.manage' })
    expect(db.reports).toEqual([])
  })
})

describe('send_documents without the invoice', () => {
  const args = { documents: [{ kind: 'report', id: '00000000-0000-4000-8000-000000000201' }], without_invoice_reason: 'Through the portal' }
  it('needs the send-without-invoice permission as well as sending', async () => {
    levels['send.report_without_invoice'] = 'blocked'
    expect((await callTool(sendDocuments, args, ctx)).text).toBe('Not allowed: send.report_without_invoice')
    levels['send.report_without_invoice'] = 'approval'
    await callTool(sendDocuments, args, ctx)
    expect(approvals[0]).toMatchObject({ action: 'send.report_without_invoice' })
    // Without a reason it's only the send permission
    levels['send.documents'] = 'blocked'
    expect((await callTool(sendDocuments, { documents: args.documents }, ctx)).text).toBe('Not allowed: send.documents')
  })
})
