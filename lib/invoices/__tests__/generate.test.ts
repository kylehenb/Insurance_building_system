import { describe, it, expect, vi, beforeEach } from 'vitest'

// generateInvoice (moved out of app/api/invoices/generate): the amounts each
// invoice type works out, what it writes, and its refusals.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
let nextId = 1
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  let op: { kind: 'insert'; rows: Row[] } | { kind: 'update'; row: Row } | { kind: 'delete' } | null = null
  const rows = () => (db[table] ??= [])
  const run = () => {
    if (op?.kind === 'insert') {
      const made = op.rows.map(r => ({ id: `${table}-${nextId++}`, ...r }))
      rows().push(...made)
      return made
    }
    const hit = rows().filter(r => preds.every(p => p(r)))
    if (op?.kind === 'update') for (const r of hit) Object.assign(r, op.row)
    if (op?.kind === 'delete') db[table] = rows().filter(r => !hit.includes(r))
    return hit.map(r => ({ ...r }))
  }
  const b: Record<string, unknown> = {
    select: () => b, order: () => b, limit: () => b,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    neq: (c: string, v: unknown) => { preds.push(r => r[c] !== v); return b },
    in: (c: string, v: unknown[]) => { preds.push(r => v.includes(r[c])); return b },
    insert: (r: Row | Row[]) => { op = { kind: 'insert', rows: Array.isArray(r) ? r : [r] }; return b },
    update: (r: Row) => { op = { kind: 'update', row: r }; return b },
    delete: () => { op = { kind: 'delete' }; return b },
    single: async () => { const r = run(); return r[0] ? { data: r[0], error: null } : { data: null, error: { message: 'no rows' } } },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res),
  }
  return b
}
const supabase = { from: query } as never

vi.mock('@/lib/invoices/ref', () => ({ generateInvoiceRef: async () => 'INV-IRC1001-01' }))
const sync = vi.fn(async () => {})
vi.mock('@/lib/accounting/sync', () => ({ syncInvoiceToAccounting: sync }))

const { generateInvoice, InvoiceGenerateError } = await import('../generate')

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  db.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001', claim_number: 'C1', insured_name: 'Pat', excess: 500, client_id: 'c1', insurer: 'Allianz', property_address: '1 Main St' }]
  db.clients = [{ id: 'c1', tenant_id: 't1', name: 'Allianz', status: 'active', builders_margin_pct: 10, bar_amount: 300 }]
  db.invoice_templates = [{ tenant_id: 't1', template_code: 'bar', is_active: true, description: 'Assessment of {property_address}, claim {claim_number}' }]
})

describe('generateInvoice', () => {
  it('prices a report invoice from the client and fills the template', async () => {
    const { invoice, lineItems } = await generateInvoice(supabase, 't1', { type: 'assessment', jobId: 'j1', reportId: 'r1' })
    expect(invoice).toMatchObject({ invoice_ref: 'INV-IRC1001-01', invoice_type: 'assessment', report_id: 'r1', amount_ex_gst: 300, gst: 30, amount_inc_gst: 330, status: 'draft' })
    expect(lineItems).toEqual([expect.objectContaining({ description: 'Assessment of 1 Main St, claim C1', line_total: 300, invoice_id: invoice.id })])
  })

  it('uses the job’s excess when none is given', async () => {
    const { invoice } = await generateInvoice(supabase, 't1', { type: 'excess', jobId: 'j1' })
    expect(invoice).toMatchObject({ invoice_type: 'excess', amount_inc_gst: 500 })
  })

  it('takes the excess off quoted amounts after GST', async () => {
    db.quotes = [
      { id: 'q1', tenant_id: 't1', job_id: 'j1', status: 'approved', gst_pct: 0.1, markup_pct: 0.2, quote_ref: 'Q1', created_at: '1' },
      { id: 'q2', tenant_id: 't1', job_id: 'j1', status: 'partially_approved', gst_pct: 0.1, markup_pct: 0.2, quote_ref: 'Q2', created_at: '2' },
    ]
    db.scope_items = [
      { tenant_id: 't1', quote_id: 'q1', item_description: 'Ceiling', qty: 1, rate_total: 1000, line_total: 1000, sort_order: 0 },
      { tenant_id: 't1', quote_id: 'q2', item_description: 'Paint', qty: 2, rate_total: 250, line_total: 500, sort_order: 0 },
    ]
    db.invoices = [{ tenant_id: 't1', job_id: 'j1', invoice_type: 'excess', status: 'sent', amount_inc_gst: 500 }]

    const { invoice, lineItems, deductions } = await generateInvoice(supabase, 't1', { type: 'quoted_amounts', jobId: 'j1' })
    // 1500 × 1.2 = 1800 ex GST, + 180 GST = 1980, − 500 excess
    expect(invoice).toMatchObject({ amount_ex_gst: 1800, gst: 180, amount_inc_gst: 1480, markup_pct: 0.2 })
    expect(lineItems.map(l => l.quote_ref)).toEqual(['Q1', 'Q2'])
    expect(deductions).toEqual([expect.objectContaining({ description: 'Policy Excess Payment Received', amount_inc_gst: 500 })])
  })

  it('refuses what it can’t do, without writing anything', async () => {
    await expect(generateInvoice(supabase, 't1', { type: 'teleport', jobId: 'j1' })).rejects.toMatchObject({ status: 400 })
    await expect(generateInvoice(supabase, 't2', { type: 'excess', jobId: 'j1' })).rejects.toMatchObject({ status: 404 })
    await expect(generateInvoice(supabase, 't1', { type: 'assessment', jobId: 'j1' })).rejects.toBeInstanceOf(InvoiceGenerateError)
    await expect(generateInvoice(supabase, 't1', { type: 'quoted_amounts', jobId: 'j1' })).rejects.toThrow('No approved quotes')
    expect(db.invoices ?? []).toHaveLength(0)
  })
})
