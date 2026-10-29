import { describe, it, expect, vi, beforeEach } from 'vitest'

// An order email whose claim number already has an order isn't made into a
// second order — and isn't dropped either: it's kept on the job (or on the
// order still waiting to be lodged) as source 'order_update'.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const inserted: Record<string, Row[]> = {}
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  let pending: Row | null = null
  const apply = () => (db[table] ?? []).filter(r => preds.every(p => p(r)))
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    order: () => b,
    limit: () => b,
    insert: (row: Row) => { pending = { id: `${table}-1`, ...row }; (inserted[table] ??= []).push(pending); return b },
    single: async () => ({ data: pending ?? apply()[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: pending ? [pending] : apply(), error: null }).then(res),
  }
  return b
}
const supabase = { from: query }
const linkThread = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => supabase }))
vi.mock('@/lib/communications/thread-link', () => ({ linkThreadToJob: (...a: unknown[]) => linkThread(...a) }))
vi.mock('@/lib/clients/resolve-insurer', () => ({ resolveInsurerClient: async () => null }))

const { writeInsurerOrder, saveOrderUpdate } = await import('../order-writer')

const msg = {
  messageId: 'm2', gmailMessageId: '<m2@castle>', threadId: 'th2', subject: 'New Quote/Report Request CHCCLM010001723', fromEmail: 'castle@primeeco.tech',
  fromName: 'Castle', to: 'office@irc.test', bodyText: 'Please allocate an electrician.', receivedAt: '2026-10-28T02:02:00Z', attachments: [],
} as never
const parsed = (claim: string) => ({
  isNewOrder: true, isNewOrderReasoning: 'New order', confidence: 0.9, parseStatus: 'auto_parsed', missingFields: [],
  data: { claim_number: claim, property_address: '92 Clement St, Swanbourne' }, rawEmailBody: 'Please allocate an electrician.', emailAttachments: [],
}) as never

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(inserted)) delete inserted[k]
  db.insurer_orders = [{ id: 'o1', tenant_id: 't1', claim_number: 'CHCCLM010001723', job_id: 'j1' }]
  db.communications = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('writeInsurerOrder', () => {
  it('says the claim already has an order, and which job, instead of writing a second', async () => {
    expect(await writeInsurerOrder(parsed('CHCCLM010001723'), msg, 't1'))
      .toEqual({ kind: 'existing_claim', orderId: 'o1', jobId: 'j1', claimNumber: 'CHCCLM010001723' })
    expect(inserted.insurer_orders).toBeUndefined()
  })

  it('writes a new order for a new claim', async () => {
    expect(await writeInsurerOrder(parsed('CLM2'), msg, 't1')).toEqual({ kind: 'created', orderId: 'insurer_orders-1' })
  })
})

describe('saveOrderUpdate', () => {
  it('keeps the email on the job and files its conversation there', async () => {
    await saveOrderUpdate(supabase as never, 't1', msg, { orderId: 'o1', jobId: 'j1' }, { communicationId: 'c9', attachments: [] })
    expect(inserted.communications[0]).toMatchObject({ id: 'c9', job_id: 'j1', insurer_order_id: null, source: 'order_update', thread_id: 'th2', body_text: 'Please allocate an electrician.' })
    expect(linkThread).toHaveBeenCalledWith(supabase, 't1', 'th2', 'j1')
  })

  it('keeps it on the order while that is still waiting to be lodged', async () => {
    await saveOrderUpdate(supabase as never, 't1', msg, { orderId: 'o1', jobId: null })
    expect(inserted.communications[0]).toMatchObject({ job_id: null, insurer_order_id: 'o1', source: 'order_update' })
    expect(linkThread).not.toHaveBeenCalled()
  })
})
