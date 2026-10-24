import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from './fake-supabase'
import { invoiceTotals } from '@/lib/invoices/totals'

// Invoice tools: reading one with its lines, raising one with the invoice
// buttons' generateInvoice, and changing it with lib/invoices/edit.ts — the
// invoice editor's totals rule.

const sync = vi.fn(async (..._a: unknown[]) => undefined)
vi.mock('@/lib/accounting/sync', () => ({ syncInvoiceToAccounting: (...a: unknown[]) => sync(...a) }))

const { getInvoice, createInvoiceTool, updateInvoiceTool, editInvoiceItems } = await import('../tools/invoices')

const db: Record<string, Row[]> = {}
const ctx = { supabase: fakeSupabase(db) as never, tenantId: 't1', userId: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(db)) delete db[k]
  db.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001', client_id: 'c1', insurer: 'Castle', excess: 500 }]
  db.clients = [{ id: 'c1', tenant_id: 't1', builders_margin_pct: 20 }]
  db.invoices = [
    { id: 'i1', tenant_id: 't1', job_id: 'j1', invoice_ref: 'INV-IRC1001-1', invoice_type: 'variations', direction: 'outbound', status: 'draft', markup_pct: 0.2, gst_treatment: 'exclusive', amount_ex_gst: 120, gst: 12, amount_inc_gst: 132, issued_date: null },
    { id: 'i2', tenant_id: 't1', job_id: 'j1', invoice_ref: 'INV-IRC1001-2', invoice_type: 'excess', direction: 'outbound', status: 'sent', markup_pct: 0, gst_treatment: 'inclusive', amount_ex_gst: 454.55, gst: 45.45, amount_inc_gst: 500, issued_date: '2026-10-01' },
    { id: 'iv', tenant_id: 't1', job_id: 'j1', invoice_ref: 'INV-IRC1001-3', invoice_type: 'custom', direction: 'outbound', status: 'voided', markup_pct: 0 },
  ]
  db.invoice_line_items = [
    { id: 'l1', tenant_id: 't1', invoice_id: 'i1', description: 'Extra downpipe', quantity: 2, unit_price: 50, line_total: 100, completed: true, sort_order: 0 },
    { id: 'l2', tenant_id: 't1', invoice_id: 'i1', description: 'Not done', quantity: 1, unit_price: 80, line_total: 80, completed: false, sort_order: 1 },
  ]
  db.invoice_deductions = []
})

describe('invoiceTotals', () => {
  it('charges ticked lines plus margin plus GST, takes deductions off quoted amounts, and leaves excess alone', () => {
    const lines = [{ line_total: 100, completed: true }, { line_total: 80, completed: false }]
    expect(invoiceTotals({ invoice_type: 'variations', markup_pct: 0.2 }, lines, [])).toEqual({ amount_ex_gst: 120, gst: 12, amount_inc_gst: 132 })
    expect(invoiceTotals({ invoice_type: 'quoted_amounts', markup_pct: 0 }, lines, [{ amount_inc_gst: 50 }])).toEqual({ amount_ex_gst: 100, gst: 10, amount_inc_gst: 60 })
    expect(invoiceTotals({ invoice_type: 'excess', markup_pct: 0 }, lines, [])).toBeNull()
  })
})

describe('get_invoice', () => {
  it('reads the lines, totals and warnings', async () => {
    const res = await getInvoice.run({ invoice_id: 'i1' }, ctx)
    expect(res.text).toMatch(/^INV-IRC1001-1 on IRC1001 \(variations\): draft\. \$120 \+ GST \$12 = \$132 \(includes 20% builder's margin\)\./)
    expect(res.text).toContain('- Extra downpipe: 2 × $50 = $100\n- Not done: 1 × $80 = $80 (not charged)')
  })

  it('lists a job\'s invoices (not voided ones) to pick from', async () => {
    const res = await getInvoice.run({ job_number: 'IRC1001' }, ctx)
    expect(res.text).toMatch(/^IRC1001 has 2 invoices — which one\?/)
    expect(res.text).not.toContain('INV-IRC1001-3')
  })
})

describe('edit_invoice_items', () => {
  it('adds, changes and removes lines and re-totals with the margin', async () => {
    const res = await editInvoiceItems.run({
      invoice_id: 'i1',
      update: [{ line_id: 'l2', charged: true, unit_price: 100 }],
      remove: ['l1'],
      add: [{ description: 'Gutter guard', quantity: 3, unit_price: 20 }],
    }, ctx)
    expect(res.isError).toBeFalsy()
    expect(db.invoice_line_items.map(l => [l.description, l.line_total, l.completed !== false])).toEqual([['Not done', 100, true], ['Gutter guard', 60, true]])
    // (100 + 60) + 20% margin = 192, + GST = 211.20
    expect(db.invoices[0]).toMatchObject({ amount_ex_gst: 192, gst: 19.2, amount_inc_gst: 211.2 })
    expect(res.text).toContain('Total now $211.20 inc GST.')
  })

  it('refuses a voided invoice, and warns that a sent one\'s copies don\'t change', async () => {
    expect((await editInvoiceItems.run({ invoice_id: 'iv', add: [{ description: 'x' }] }, ctx)).isError).toBe(true)
    const sent = await editInvoiceItems.run({ invoice_id: 'i2', add: [{ description: 'Admin fee', unit_price: 10 }] }, ctx)
    expect(sent.text).toContain('changes here don\'t update the copy')
    expect(db.invoices[1].amount_inc_gst).toBe(500)
  })
})

describe('update_invoice', () => {
  it('sets the date while it\'s a draft and re-totals on a new margin; the date of a sent invoice is locked', async () => {
    await updateInvoiceTool.run({ invoice_id: 'i1', issued_date: '2026-10-24', builders_margin_pct: 10 }, ctx)
    expect(db.invoices[0]).toMatchObject({ issued_date: '2026-10-24', markup_pct: 0.1, amount_ex_gst: 110, amount_inc_gst: 121 })
    const locked = await updateInvoiceTool.run({ invoice_id: 'i2', issued_date: '2026-10-24' }, ctx)
    expect(locked).toMatchObject({ isError: true, text: 'Invoice date is locked once the invoice has been sent' })
    expect(sync).not.toHaveBeenCalled()
  })
})

describe('create_invoice', () => {
  it('raises a custom invoice at the insurer\'s margin and adds its lines', async () => {
    const res = await createInvoiceTool.run({ job_number: 'IRC1001', type: 'custom', lines: [{ description: 'Skip bin', quantity: 1, unit_price: 400 }] }, ctx)
    expect(res.isError).toBeFalsy()
    const inv = db.invoices.find(i => i.invoice_ref === 'INV-IRC1001-4')!
    expect(inv).toMatchObject({ invoice_type: 'custom', status: 'draft', markup_pct: 0.2, amount_ex_gst: 480, amount_inc_gst: 528 })
    expect(res.text).toMatch(/^Created INV-IRC1001-4 as a draft\./)
  })

  it('asks for the report on a report invoice', async () => {
    const res = await createInvoiceTool.run({ job_number: 'IRC1001', type: 'assessment' }, ctx)
    expect(res).toMatchObject({ isError: true })
    expect(res.text).toContain('Which report')
  })
})
