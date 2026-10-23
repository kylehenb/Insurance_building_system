import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Order tools: finding an order email the auto lodger missed, turning it into
// an order with the lodger's own reader, and lodging with the Lodge button's
// function — plus the Lodge button still answering exactly as before.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  const apply = () => (db[table] ?? []).filter(r => preds.every(p => p(r)))
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    is: (c: string, v: unknown) => { preds.push(r => (r[c] ?? null) === v); return b },
    like: (c: string, p: string) => { const needle = p.replace(/%/g, ''); preds.push(r => String(r[c] ?? '').includes(needle)); return b },
    order: () => b,
    limit: () => b,
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: apply(), error: null }).then(res),
  }
  return b
}

const gmail = { list: vi.fn(), get: vi.fn() }
const parse = vi.fn()
const write = vi.fn()
const lodge = vi.fn()
class LodgeError extends Error {
  constructor(message: string, public readonly status: number, public readonly details: Record<string, unknown> = {}) { super(message) }
}
vi.mock('@/lib/gmail/client', () => ({ getGmailClient: () => ({ users: { messages: { list: gmail.list, get: gmail.get } } }) }))
vi.mock('@/lib/gmail/messages', () => ({
  getFullMessage: async (id: string) => ({ id }),
  extractMessageParts: async (m: { id: string }) => ({ messageId: m.id, fromEmail: m.id === 'ours0001' ? 'kyle@insurancerepairco.com.au' : 'castleinsurance.mailer@primeeco.tech', subject: 'New Quote/Report Request' }),
}))
vi.mock('@/lib/email/order-parser', () => ({ parseInsurerOrder: (...a: unknown[]) => parse(...a) }))
vi.mock('@/lib/email/order-writer', () => ({ writeInsurerOrder: (...a: unknown[]) => write(...a) }))
vi.mock('@/lib/insurer-orders/lodge', () => ({ LodgeError, lodgeInsurerOrder: (...a: unknown[]) => lodge(...a) }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ from: query }) }))
// Permissions are tested in lib/permissions; here the user is allowed
vi.mock('@/lib/permissions/http', () => ({ permissionDenied: async () => null, permissionGate: async () => null }))
let sessionTenant: string | null = 't1'
vi.mock('@/lib/supabase/get-user', () => ({ getUser: async () => (sessionTenant ? { tenant_id: sessionTenant } : null) }))

const { listInsurerOrders, findOrderEmails, createOrderFromEmail, lodgeOrder } = await import('../tools/orders')
const { POST: lodgeRoute } = await import('@/app/api/insurer-orders/lodge/route')

const ctx = { supabase: { from: query } as never, tenantId: 't1', userId: 'u1' }
const ORDER_ID = '33333333-3333-3333-3333-333333333333'
const order = (over: Row = {}) => ({
  id: ORDER_ID, tenant_id: 't1', created_at: '2026-10-22T05:56:00Z', status: 'pending', parse_status: 'auto_parsed', entry_method: 'email',
  claim_number: 'CHCCLM010002035', insurer: 'Castle', wo_type: 'BAR', property_address: '45 Randell Crescent, Ocean Reef',
  insured_name: 'Peter Laundy', insured_phone: null, date_of_loss: null, loss_type: null, excess_building: 500, job_id: null,
  raw_email_subject: 'New Quote/Report Request', raw_email_link: 'https://mail.google.com/mail/u/0/#inbox/abc12345', ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.insurer_orders = []
  db.communications = []
  parse.mockResolvedValue({ isNewOrder: false, isNewOrderReasoning: 'Looks like a reply', data: {} })
  write.mockImplementation(async () => { db.insurer_orders.push(order()); return ORDER_ID })
  gmail.list.mockResolvedValue({ data: { messages: [{ id: 'abc12345' }] } })
  gmail.get.mockResolvedValue({ data: { threadId: 'th1', internalDate: String(Date.parse('2026-10-22T05:56:00Z')), payload: { headers: [
    { name: 'From', value: 'Castle <castleinsurance.mailer@primeeco.tech>' },
    { name: 'Subject', value: 'New Quote/Report Request CHCCLM010002035 Peter Laundy 45 Randell Crescent, Ocean Reef' },
  ] } } })
  lodge.mockResolvedValue({ jobNumber: 'IRC1080', jobId: 'j80' })
})

describe('list_insurer_orders', () => {
  it('lists pending orders and flags what’s missing', async () => {
    db.insurer_orders = [order(), order({ id: 'o2', claim_number: null, parse_status: 'needs_review' }), order({ id: 'o3', job_id: 'j1', status: 'lodged' })]
    const res = await listInsurerOrders.run({}, ctx)
    expect(res.text).toMatch(/^2 orders waiting to be lodged:/)
    expect(res.text).toContain('claim CHCCLM010002035, Castle, assessment (BAR), Peter Laundy, 45 Randell Crescent, Ocean Reef, excess $500')
    expect(res.text).toContain('No claim number — it can\'t be lodged until one is added in the app.')
  })
})

describe('find_order_emails', () => {
  it('searches the inbox (not our own emails) and says the email isn’t in the system', async () => {
    const res = await findOrderEmails.run({ query: 'CHCCLM010002035' }, ctx)
    expect(gmail.list).toHaveBeenCalledWith(expect.objectContaining({ q: 'CHCCLM010002035 -from:insurancerepairco.com.au newer_than:90d' }))
    expect(res.text).toMatch(/from Castle <castleinsurance\.mailer@primeeco\.tech>: "New Quote\/Report Request CHCCLM010002035 .*" — not in the system\./)
  })

  it('recognises an email that is already an order or on a job', async () => {
    db.insurer_orders = [order()]
    expect((await findOrderEmails.run({ query: 'x' }, ctx)).text).toContain('already an order (pending, claim CHCCLM010002035)')
    db.insurer_orders = []
    db.communications = [{ tenant_id: 't1', thread_id: 'th1', job_id: 'j9', insurer_order_id: null }]
    expect((await findOrderEmails.run({ query: 'x' }, ctx)).text).toContain('its conversation is already on a job')
  })
})

describe('create_order_from_email', () => {
  it('writes the order even when the reader said it wasn’t one, and reads it back', async () => {
    const res = await createOrderFromEmail.run({ message_id: 'abc12345' }, ctx)
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'abc12345' }), null, 't1')
    expect(write.mock.calls[0][0]).toMatchObject({ isNewOrder: true, isNewOrderReasoning: 'Created on request by voice. Reader said: Looks like a reply' })
    expect(res.text).toMatch(/^Created the order: claim CHCCLM010002035, .* It is ready to lodge\.$/)
  })

  it('returns the existing order instead of creating a second', async () => {
    db.insurer_orders = [order()]
    const res = await createOrderFromEmail.run({ message_id: 'abc12345' }, ctx)
    expect(res.text).toMatch(/^That email is already an order:/)
    expect(write).not.toHaveBeenCalled()
  })

  it('refuses our own emails and explains a reader failure', async () => {
    expect((await createOrderFromEmail.run({ message_id: 'ours0001' }, ctx)).isError).toBe(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    parse.mockRejectedValueOnce(new Error('Gemini could not classify the email: 404 model not found'))
    const res = await createOrderFromEmail.run({ message_id: 'abc12345' }, ctx)
    expect(res).toMatchObject({ isError: true, text: expect.stringContaining('404 model not found') })
  })
})

describe('lodge_order', () => {
  it('lodges through the Lodge button’s function, scoped to the tenant', async () => {
    const res = await lodgeOrder.run({ order_id: ORDER_ID }, ctx)
    expect(lodge).toHaveBeenCalledWith(ctx.supabase, ORDER_ID, { tenantId: 't1' })
    expect(res.text).toBe('Lodged as job IRC1080.')
  })

  it('reports a link to the existing job, and the same-address warning', async () => {
    lodge.mockResolvedValueOnce({ jobNumber: 'IRC1001', jobId: 'j1', linkedToExisting: true })
    expect((await lodgeOrder.run({ order_id: ORDER_ID }, ctx)).text).toBe('That claim already has job IRC1001, so the order was linked to it.')
    lodge.mockRejectedValueOnce(new LodgeError('Address already exists in system', 409, { warning: true, matchingJobs: [{ jobNumber: 'IRC1050', claimNumber: 'CHCCLM1' }] }))
    const res = await lodgeOrder.run({ order_id: ORDER_ID }, ctx)
    expect(res).toMatchObject({ isError: true, text: expect.stringContaining('job IRC1050 (claim CHCCLM1)') })
  })
  it('says whether the acknowledgement went to the order’s sender', async () => {
    lodge.mockResolvedValueOnce({ jobNumber: 'IRC1080', jobId: 'j80', acknowledgement: { sent: true, to: 'claims@castle.com.au' } })
    expect((await lodgeOrder.run({ order_id: ORDER_ID }, ctx)).text).toBe('Lodged as job IRC1080. Acknowledgement emailed to claims@castle.com.au.')
    lodge.mockResolvedValueOnce({ jobNumber: 'IRC1080', jobId: 'j80', acknowledgement: { sent: false, skipped: 'The order has no sender email address' } })
    const res = await lodgeOrder.run({ order_id: ORDER_ID }, ctx)
    expect(res.text).toBe("Lodged as job IRC1080. The acknowledgement wasn't sent: The order has no sender email address.")
    expect(res.data).toMatchObject({ acknowledgement_sent: false })
  })
})

describe('Lodge button route', () => {
  const post = (body: unknown) => lodgeRoute(new NextRequest('https://app.test/api/insurer-orders/lodge', { method: 'POST', body: JSON.stringify(body) }))

  it('answers as before: the job, the address warning with its fields, and errors', async () => {
    expect(await (await post({ orderId: ORDER_ID })).json()).toEqual({ jobNumber: 'IRC1080', jobId: 'j80' })
    expect(lodge).toHaveBeenCalledWith(expect.anything(), ORDER_ID, { tenantId: 't1' })

    lodge.mockRejectedValueOnce(new LodgeError('Address already exists in system', 409, { warning: true, matchingJobs: [], message: 'Found 1…' }))
    const warn = await post({ orderId: ORDER_ID })
    expect(warn.status).toBe(409)
    expect(await warn.json()).toEqual({ error: 'Address already exists in system', warning: true, matchingJobs: [], message: 'Found 1…' })

    expect((await post({})).status).toBe(400)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    lodge.mockRejectedValueOnce(new Error('boom'))
    const boom = await post({ orderId: ORDER_ID })
    expect(boom.status).toBe(500)
    expect(await boom.json()).toEqual({ error: 'Internal server error' })
  })

  it('refuses without a signed-in user', async () => {
    sessionTenant = null
    const res = await post({ orderId: ORDER_ID })
    sessionTenant = 't1'
    expect(res.status).toBe(401)
    expect(lodge).not.toHaveBeenCalled()
  })
})
