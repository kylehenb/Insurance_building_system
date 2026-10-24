import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from './fake-supabase'

// Work order tools: a work order's items as the tab and PDF show them, Sync
// from quote, adding one for a trade, and changing it and its items — the
// item changes kept in the work order's notes, never on the quote.

const { getWorkOrder, createWorkOrdersFromQuote, createWorkOrderTool, updateWorkOrderTool, editWorkOrderItems } = await import('../tools/work-order-edit')

const db: Record<string, Row[]> = {}
const ctx = { supabase: fakeSupabase(db) as never, tenantId: 't1', userId: 'u1' }
const notes = (id: string) => JSON.parse(String(db.work_orders.find(w => w.id === id)!.notes ?? '{}'))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  for (const k of Object.keys(db)) delete db[k]
  db.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001', property_address: '1 Test St', insured_name: 'Smith' }]
  db.trades = [
    { id: 'tr1', tenant_id: 't1', business_name: 'Plaster Co', primary_trade: 'Plasterer', primary_contact: 'Pete', contact_email: 'pete@plaster.test' },
    { id: 'tr2', tenant_id: 't1', business_name: 'Sparky Ltd', primary_trade: 'Electrician', primary_contact: 'Sam', contact_email: null },
    { id: 'tr3', tenant_id: 't1', business_name: 'Sparks & Co', primary_trade: 'Electrician', primary_contact: 'Sue', contact_email: null },
  ]
  db.quotes = [{ id: 'q1', tenant_id: 't1', job_id: 'j1', status: 'approved', is_active_version: true, created_at: '2026-09-01' }]
  db.scope_items = [
    { id: 's1', tenant_id: 't1', quote_id: 'q1', trade: 'Plasterer', item_description: 'Patch ceiling', qty: 2, rate_labour: 40, rate_materials: 10, line_total: 100, room: 'Kitchen', approval_status: 'approved', assigned_work_order_id: null, estimated_hours: 3, sort_order: 1 },
    { id: 's2', tenant_id: 't1', quote_id: 'q1', trade: 'Plasterer', item_description: 'Patch wall', qty: 1, rate_labour: 60, rate_materials: 0, line_total: 60, room: 'Kitchen', approval_status: 'approved', assigned_work_order_id: null, estimated_hours: 1, sort_order: 2 },
    { id: 's3', tenant_id: 't1', quote_id: 'q1', trade: 'Electrician', item_description: 'Replace fan', qty: 1, rate_labour: 200, rate_materials: 0, line_total: 200, room: 'Bathroom', approval_status: 'declined', assigned_work_order_id: null, estimated_hours: 1, sort_order: 3 },
  ]
  db.work_orders = [
    { id: 'wo1', tenant_id: 't1', job_id: 'j1', quote_id: 'q1', trade_id: 'tr1', trade_name: 'Plasterer', agreed_amount: null, notes: null, gary_state: 'not_started', status: 'pending', sequence_order: null, estimated_hours: 4 },
  ]
  db.work_order_visits = []
  db.trade_type_sequence = []
  db.communications = []
})

describe('get_work_order', () => {
  it('shows the trade\'s quote items and their total', async () => {
    const res = await getWorkOrder.run({ work_order_id: 'wo1' }, ctx)
    expect(res.text).toMatch(/^Plasterer \(Plaster Co\) work order on IRC1001: \$160 from its items, not sent\./)
    expect(res.text).toContain('- Patch ceiling [Kitchen]: 2 × $50 = $100\n- Patch wall [Kitchen]: 1 × $60 = $60')
  })
})

describe('edit_work_order_items', () => {
  it('overrides, removes and adds items on the work order only, leaving the quote alone', async () => {
    const res = await editWorkOrderItems.run({
      work_order_id: 'wo1',
      update: [{ item_id: 's1', qty: 3 }],
      remove: ['s2'],
      add: [{ description: 'Cornice repair', qty: 2, rate_labour: 25 }],
    }, ctx)
    expect(res.isError).toBeFalsy()
    const n = notes('wo1')
    expect(n.item_overrides.s1).toMatchObject({ qty: 3, line_total: 150 })
    expect(n.deleted_scope_item_ids).toEqual(['s2'])
    expect(n.added_items).toEqual([expect.objectContaining({ item_description: 'Cornice repair', qty: 2, line_total: 50, trade: 'Plasterer' })])
    expect(db.scope_items.find(i => i.id === 's1')!.qty).toBe(2)
    // 150 + 50, the removed wall patch not counted
    expect(res.text).toContain('$200 from its items')

    await editWorkOrderItems.run({ work_order_id: 'wo1', restore: ['s2'] }, ctx)
    expect(notes('wo1').deleted_scope_item_ids).toEqual([])
  })

  it('refuses items that aren\'t on the work order', async () => {
    const res = await editWorkOrderItems.run({ work_order_id: 'wo1', remove: ['s3'] }, ctx)
    expect(res.isError).toBe(true)
  })
})

describe('update_work_order', () => {
  it('sets the contractor by name and the agreed amount, and asks when a name matches several', async () => {
    const ambiguous = await updateWorkOrderTool.run({ work_order_id: 'wo1', contractor: 'spark' }, ctx)
    expect(ambiguous.isError).toBe(true)
    expect(ambiguous.text).toContain('Several contractors match "spark": Sparky Ltd (Electrician), Sparks & Co (Electrician)')

    const res = await updateWorkOrderTool.run({ work_order_id: 'wo1', contractor: 'Sam', agreed_amount: 900 }, ctx)
    expect(res.text).toMatch(/^Updated: contractor Sparky Ltd, agreed amount \$900\./)
    expect(db.work_orders[0]).toMatchObject({ trade_id: 'tr2', agreed_amount: 900 })
  })
})

describe('creating work orders', () => {
  it('syncs from the approved quote, skipping declined items and trades that already have one', async () => {
    const res = await createWorkOrdersFromQuote.run({ job_number: 'IRC1001' }, ctx)
    expect(res.text).toBe('IRC1001: No new work orders created — all 1 trade in the quote already have work orders.')
    db.work_orders = []
    const again = await createWorkOrdersFromQuote.run({ job_number: 'IRC1001' }, ctx)
    expect(again.text).toMatch(/^IRC1001: created 1 work order — Plasterer\./)
    expect(db.work_orders[0]).toMatchObject({ trade_id: 'tr1', estimated_hours: 4, gary_state: 'not_started' })
    expect(db.work_order_visits).toHaveLength(1)
  })

  it('adds one for a trade, on the approved quote, with its contractor', async () => {
    const res = await createWorkOrderTool.run({ job_number: 'IRC1001', trade_name: 'Electrician', contractor: 'Sparks & Co' }, ctx)
    expect(res.isError).toBeFalsy()
    expect(db.work_orders[1]).toMatchObject({ trade_name: 'Electrician', trade_id: 'tr3', quote_id: 'q1', status: 'pending' })
  })
})
