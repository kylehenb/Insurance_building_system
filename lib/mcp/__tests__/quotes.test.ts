import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from './fake-supabase'

// Quote tools: reading line items, finding earlier lines, creating and
// editing quotes. They run on lib/quotes/service.ts — the quote routes' own
// functions — so totals, preliminaries, the lock rule and approval side
// effects are the app's.

const recompute = vi.fn(async (..._a: unknown[]) => 'approved_awaiting_signoff')
vi.mock('@/lib/jobs/recomputeStage', () => ({ recomputeAndSaveStage: (...a: unknown[]) => recompute(...a) }))

const { getQuote, findLineItemsTool, createQuoteTool, updateQuoteTool, editQuoteItems } = await import('../tools/quotes')

const db: Record<string, Row[]> = {}
const ctx = { supabase: fakeSupabase(db) as never, tenantId: 't1', userId: 'u1' }
const item = (id: string, quote: string, over: Row = {}): Row => ({
  id, tenant_id: 't1', quote_id: quote, room: 'Kitchen', item_description: 'Patch plaster ceiling', qty: 2, unit: 'm2',
  rate_labour: 40, rate_materials: 10, rate_total: 50, line_total: 100, trade: 'Plasterer', approval_status: 'pending',
  scope_library_id: null, preliminary_formula: null, sort_order: 1, created_at: '2026-09-01T00:00:00Z', assigned_work_order_id: null, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  for (const k of Object.keys(db)) delete db[k]
  db.jobs = [
    { id: 'j1', tenant_id: 't1', job_number: 'IRC1001', property_address: '1 Test St', client_id: 'c1' },
    { id: 'j2', tenant_id: 't1', job_number: 'IRC1002', property_address: '2 Test St', client_id: null },
    { id: 'jx', tenant_id: 'other', job_number: 'IRC9999', property_address: 'Elsewhere', client_id: null },
  ]
  db.clients = [{ id: 'c1', tenant_id: 't1', builders_margin_pct: 20 }]
  db.quotes = [
    { id: 'q1', tenant_id: 't1', job_id: 'j1', quote_ref: 'Q-IRC1001-1', status: 'draft', is_locked: false, is_active_version: true, markup_pct: 0.2, gst_pct: 0.1, room_order: ['Kitchen', 'Bathroom'], approved_amount: null, total_amount: null, created_at: '2026-09-01T00:00:00Z' },
    { id: 'q2', tenant_id: 't1', job_id: 'j2', quote_ref: 'Q-IRC1002-1', status: 'sent', is_locked: true, is_active_version: true, markup_pct: 0.2, gst_pct: 0.1, room_order: null, approved_amount: null, total_amount: null, created_at: '2026-08-01T00:00:00Z' },
    { id: 'qx', tenant_id: 'other', job_id: 'jx', quote_ref: 'Q-IRC9999-1', status: 'draft', is_locked: false, is_active_version: true, markup_pct: 0.2, gst_pct: 0.1 },
  ]
  db.scope_items = [
    item('s1', 'q1'),
    item('s2', 'q1', { room: 'Bathroom', item_description: 'Replace exhaust fan', qty: 1, unit: 'each', rate_labour: 120, rate_materials: 80, line_total: 200, trade: 'Electrician', sort_order: 2 }),
    item('s3', 'q2', { item_description: 'Patch plaster wall', rate_labour: 35, line_total: 90, created_at: '2026-08-01T00:00:00Z' }),
    item('sx', 'qx', { tenant_id: 'other', item_description: 'Patch plaster secret' }),
  ]
  db.scope_library = [
    { id: 'lib1', tenant_id: 't1', item_description: 'Plaster ceiling sheet replace', unit: 'm2', labour_per_unit: 55, materials_per_unit: 25, trade: 'Plasterer', keyword: 'ceiling', trade_rate_total: 70, approval_status: 'approved' },
  ]
  db.work_orders = []
  db.trades = [{ id: 'tr1', tenant_id: 't1', primary_trade: 'Plasterer', business_name: 'Plaster Co' }]
  db.trade_type_sequence = []
  db.work_order_visits = []
})

describe('get_quote', () => {
  it('reads the items room by room, in the quote\'s room order, with the PDF total', async () => {
    const res = await getQuote.run({ quote_id: 'q1' }, ctx)
    expect(res.text).toMatch(/^Q-IRC1001-1 on IRC1001: draft\. 2 items, subtotal \$300, builder's margin 20%, total \$396 inc GST\./)
    expect(res.text).toContain('Kitchen:\n- Patch plaster ceiling: 2 m2 × $50 = $100 (Plasterer)\nBathroom:\n- Replace exhaust fan: 1 each × $200 = $200 (Electrician)')
    const quote = (res.data as { quote: { items: { item_id: string }[] } }).quote
    expect(quote.items.map(i => i.item_id)).toEqual(['s1', 's2'])
  })

  it('opens the only quote when given a job, and never another tenant\'s quote', async () => {
    expect((await getQuote.run({ job_number: 'irc 1001' }, ctx)).text).toMatch(/^Q-IRC1001-1/)
    expect((await getQuote.run({ quote_id: 'qx' }, ctx)).isError).toBe(true)
  })
})

describe('find_line_items', () => {
  it('finds earlier lines by every word, newest first, with job and quote, plus library items', async () => {
    const res = await findLineItemsTool.run({ query: 'patch plaster', include_library: false }, ctx)
    const items = (res.data as { items: { id: string; job_number: string }[] }).items
    expect(items.map(i => i.id)).toEqual(['s1', 's3'])
    expect(items[1].job_number).toBe('IRC1002')
    const withLib = await findLineItemsTool.run({ query: 'plaster ceiling', include_library: true }, ctx)
    expect((withLib.data as { items: { id: string }[] }).items.map(i => i.id)).toEqual(['s1', 'lib1'])
    expect(withLib.text).toContain('- Library: Plaster ceiling sheet replace, $80 per m2 (Plasterer)')
  })

  it('narrows to one job', async () => {
    const res = await findLineItemsTool.run({ query: 'plaster', job_number: 'IRC1002' }, ctx)
    expect((res.data as { items: { id: string }[] }).items.map(i => i.id)).toEqual(['s3'])
  })
})

describe('create_quote', () => {
  it('creates a draft at the insurer\'s margin, copies an earlier quote\'s lines and adds a library line', async () => {
    const res = await createQuoteTool.run({
      job_number: 'IRC1001', copy_items_from_quote_id: 'q2',
      items: [{ room: 'Lounge', library_item_id: 'lib1', qty: 3 }],
    }, ctx)
    expect(res.isError).toBeFalsy()
    const created = db.quotes.find(q => q.quote_ref === 'Q-IRC1001-2')!
    expect(created).toMatchObject({ status: 'draft', is_locked: false, markup_pct: 0.2, job_id: 'j1' })
    const lines = db.scope_items.filter(i => i.quote_id === created.id)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ item_description: 'Patch plaster wall', approval_status: 'pending' })
    expect(lines[1]).toMatchObject({ item_description: 'Plaster ceiling sheet replace', room: 'Lounge', qty: 3, rate_total: 80, line_total: 240, scope_library_id: 'lib1', is_custom: false })
    expect(res.text).toMatch(/^Created Q-IRC1001-2 on IRC1001 as a draft and copied 1 lines and added 1\./)
  })
})

describe('edit_quote_items', () => {
  it('adds, changes and removes lines with the editor\'s totals, then re-prices preliminaries', async () => {
    db.scope_items.push(item('p1', 'q1', { room: 'Preliminaries', item_description: 'Home indemnity insurance', preliminary_formula: 'hii', qty: 1, rate_labour: null, rate_materials: 700, line_total: 700, trade: null }))
    const res = await editQuoteItems.run({
      quote_id: 'q1',
      update: [{ item_id: 's1', qty: 4 }],
      remove: ['s2'],
      add: [{ room: 'Kitchen', description: 'Paint ceiling', qty: 10, unit: 'm2', rate_labour: 12, rate_materials: 0, trade: 'Painter' }],
    }, ctx)
    expect(res.isError).toBeFalsy()
    expect(db.scope_items.find(i => i.id === 's1')).toMatchObject({ qty: 4, line_total: 200, rate_total: 50 })
    expect(db.scope_items.some(i => i.id === 's2')).toBe(false)
    expect(db.scope_items.find(i => i.item_description === 'Paint ceiling')).toMatchObject({ line_total: 120, is_custom: true, sort_order: 2 })
    // Subtotal without preliminaries is now $320 → insurance stays at its $700 minimum
    expect(db.scope_items.find(i => i.id === 'p1')).toMatchObject({ rate_materials: 700 })
    expect(res.text).toMatch(/^Q-IRC1001-1: removed Replace exhaust fan; changed Patch plaster ceiling \(now \$200\); added Paint ceiling \(\$120\)\./)
  })

  it('refuses a locked quote and items from another quote', async () => {
    const locked = await editQuoteItems.run({ quote_id: 'q2', remove: ['s3'] }, ctx)
    expect(locked).toMatchObject({ isError: true })
    expect(locked.text).toContain('is locked (sent)')
    const foreign = await editQuoteItems.run({ quote_id: 'q1', remove: ['s3'] }, ctx)
    expect(foreign.isError).toBe(true)
    expect(db.scope_items.some(i => i.id === 's3')).toBe(true)
  })
})

describe('update_quote', () => {
  it('marks it ready (locked) and back to an unlocked draft, recomputing the stage', async () => {
    await updateQuoteTool.run({ quote_id: 'q1', status: 'ready' }, ctx)
    expect(db.quotes[0]).toMatchObject({ status: 'ready', is_locked: true })
    expect(recompute).toHaveBeenCalledWith('j1')
    const margin = await updateQuoteTool.run({ quote_id: 'q1', builders_margin_pct: 15 }, ctx)
    expect(margin.isError).toBe(true)
    await updateQuoteTool.run({ quote_id: 'q1', status: 'draft', builders_margin_pct: 15 }, ctx)
    expect(db.quotes[0]).toMatchObject({ status: 'draft', is_locked: false, markup_pct: 0.15 })
  })

  it('partly approves: chosen items approved, the rest declined, work orders made for the approved trades', async () => {
    const res = await updateQuoteTool.run({ quote_id: 'q1', status: 'partially_approved', approved_item_ids: ['s1'] }, ctx)
    expect(res.isError).toBeFalsy()
    expect(db.scope_items.find(i => i.id === 's1')!.approval_status).toBe('approved')
    expect(db.scope_items.find(i => i.id === 's2')!.approval_status).toBe('declined')
    expect(db.quotes[0]).toMatchObject({ status: 'partially_approved', is_locked: true, approved_amount: 132 })
    expect(db.work_orders.map(w => [w.trade_name, w.trade_id])).toEqual([['Plasterer', 'tr1']])
    expect(res.text).toContain('Created 1 work order: Plasterer.')
  })

  it('records the approved amount on a full approval from the items, margin and GST', async () => {
    const res = await updateQuoteTool.run({ quote_id: 'q1', status: 'approved' }, ctx)
    // $300 of items + 20% margin + 10% GST
    expect(db.quotes[0]).toMatchObject({ status: 'approved', is_locked: true, approved_amount: 396 })
    expect(res.text).toContain('Approved amount $396.')
    expect(db.work_orders.map(w => w.trade_name).sort()).toEqual(['Electrician', 'Plasterer'])
  })

  it('records the reason on a rejection', async () => {
    await updateQuoteTool.run({ quote_id: 'q1', status: 'rejected', reason: 'Claim denied by insurer' }, ctx)
    expect(db.quotes[0]).toMatchObject({ status: 'rejected', is_locked: true, approval_notes: 'Claim denied by insurer' })
  })
})
