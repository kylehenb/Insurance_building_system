import { describe, it, expect, beforeEach } from 'vitest'
import { findWorkOrders, normaliseJobNumber, type WorkOrderSummary } from '../tools/work-orders'

// find_work_orders reports what Claude needs to ask the right questions:
// which trade, where it goes, the amount, and whether it has already gone.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}

const likeToRegex = (pattern: string) =>
  new RegExp(`^${pattern.replace(/\\(.)|([%*])|([^\\%*])/g, (_m, esc, wild, ch) =>
    esc ? esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : wild ? '.*' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}$`, 'is')

function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  let limit = Infinity
  const apply = () => (db[table] ?? []).filter(r => preds.every(p => p(r))).slice(0, limit)
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    in: (c: string, vs: unknown[]) => { preds.push(r => vs.includes(r[c])); return b },
    ilike: (c: string, p: string) => { preds.push(r => likeToRegex(p).test(String(r[c] ?? ''))); return b },
    // Only the shape find_work_orders uses: "<col>.is.null,<col>.like.<prefix>*"
    or: (expr: string) => {
      const [, col, prefix] = expr.match(/^(\w+)\.is\.null,\w+\.like\.(\w+)\*$/) ?? []
      preds.push(r => r[col] == null || String(r[col]).startsWith(prefix))
      return b
    },
    order: (c: string, o?: { ascending?: boolean }) => {
      const dir = o?.ascending === false ? -1 : 1
      db[table] = [...(db[table] ?? [])].sort((x, y) => String(x[c]).localeCompare(String(y[c])) * dir)
      return b
    },
    limit: (n: number) => { limit = n; return b },
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: apply(), error: null }).then(res),
  }
  return b
}
const ctx = { supabase: { from: query } as never, tenantId: 't1', userId: 'u1' }
const run = (args: Record<string, unknown>) => findWorkOrders.run(args, ctx)
const workOrders = (data: unknown) => (data as { work_orders: WorkOrderSummary[] }).work_orders

beforeEach(() => {
  db.jobs = [
    { id: 'j1', tenant_id: 't1', job_number: 'IRC1001', property_address: '1 Test St', insured_name: 'Smith' },
    { id: 'j2', tenant_id: 't1', job_number: 'IRC1002', property_address: '2 Test St', insured_name: 'Jones' },
    { id: 'jx', tenant_id: 'other', job_number: 'IRC1003', property_address: 'Elsewhere', insured_name: 'X' },
  ]
  db.trades = [
    { id: 'tr1', tenant_id: 't1', business_name: 'Plaster Co', primary_trade: 'Plasterer', contact_email: 'plaster@example.com' },
    { id: 'tr2', tenant_id: 't1', business_name: 'Sparky Ltd', primary_trade: 'Electrician', contact_email: null },
  ]
  db.work_orders = [
    { id: 'wo1', tenant_id: 't1', job_id: 'j1', trade_id: 'tr1', trade_name: 'Plasterer', quote_id: null, agreed_amount: 1200, notes: null, gary_state: 'not_started', status: 'pending', created_at: '1' },
    { id: 'wo2', tenant_id: 't1', job_id: 'j1', trade_id: 'tr2', trade_name: 'Electrician', quote_id: null, agreed_amount: null, notes: null, gary_state: 'not_started\n', status: 'pending', created_at: '2' },
    { id: 'wo3', tenant_id: 't1', job_id: 'j1', trade_id: 'tr1', trade_name: 'Plasterer', quote_id: null, agreed_amount: 800, notes: null, gary_state: 'waiting_reply', status: 'engaged', created_at: '3' },
    { id: 'wo4', tenant_id: 't1', job_id: 'j2', trade_id: null, trade_name: 'Painter', quote_id: null, agreed_amount: 500, notes: null, gary_state: null, status: 'pending', created_at: '4' },
    { id: 'wox', tenant_id: 'other', job_id: 'jx', trade_id: null, trade_name: 'Roofer', quote_id: null, agreed_amount: 9, notes: null, gary_state: 'not_started', status: 'pending', created_at: '5' },
  ]
  db.scope_items = []
  db.communications = [
    { tenant_id: 't1', work_order_id: 'wo3', source: 'work_order_send', created_at: '2026-10-20T13:56:54Z', to_email: 'kyle@example.com' },
  ]
})

describe('find_work_orders', () => {
  it('normalises spoken job numbers', () => {
    expect(normaliseJobNumber(' irc 1001 ')).toBe('IRC1001')
    expect(normaliseJobNumber('IRC-1001')).toBe('IRC1001')
  })

  it('lists a job’s work orders with recipient, amount and sent state', async () => {
    const res = await run({ job_number: 'irc 1001' })
    expect(res.isError).toBeFalsy()
    const [plaster, sparky, sentPlaster] = workOrders(res.data)
    expect(plaster).toMatchObject({ work_order_id: 'wo1', trade: 'Plasterer', recipient: 'plaster@example.com', amount: 1200, sent: false, warnings: [] })
    expect(sparky).toMatchObject({ sent: false, recipient: null, amount: null })
    expect(sentPlaster).toMatchObject({ sent: true, last_sent: { to: 'kyle@example.com' } })
    expect(res.text).toMatch(/^IRC1001, 1 Test St: 3 work orders, 2 not sent\./)
  })

  it('warns about a missing email, a $0 amount and an earlier send', async () => {
    const [, sparky, sentPlaster] = workOrders((await run({ job_number: 'IRC1001' })).data)
    expect(sparky.warnings).toEqual(['Sparky Ltd has no email address — ask who to send it to.', 'The amount is $0 — no allocation set.'])
    // The comma after the weekday depends on the runtime's ICU data
    expect(sentPlaster.warnings).toEqual([expect.stringMatching(/^Already sent on Tue,? 20 Oct to kyle@example\.com\.$/)])
  })

  it('suggests close job numbers and never crosses tenants', async () => {
    const res = await run({ job_number: 'IRC100' })
    expect(res.isError).toBe(true)
    expect(res.text).toBe('No job IRC100. Did you mean IRC1001, IRC1002?')
    expect((await run({ job_number: 'IRC1003' })).isError).toBe(true)
  })

  it('lists only unsent work orders when no job is given', async () => {
    const res = await run({})
    expect(workOrders(res.data).map(w => w.work_order_id)).toEqual(['wo1', 'wo2', 'wo4'])
    expect(workOrders(res.data)[2].warnings).toEqual(['No trade is assigned yet.'])
    expect(res.text).toMatch(/^3 work orders not sent yet, across 2 jobs\./)
  })
})
