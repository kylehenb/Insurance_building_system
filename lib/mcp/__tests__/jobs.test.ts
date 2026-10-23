import { describe, it, expect, vi, beforeEach } from 'vitest'

// Job summary (assembled from the app's stage logic, pending actions and the
// other tools' views), job notes, and correcting / linking insurer orders.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const updates: { table: string; patch: Row }[] = []
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  let patch: Row | null = null
  const apply = () => (db[table] ?? []).filter(r => preds.every(p => p(r)))
  const run = () => {
    const rows = apply()
    if (patch) { rows.forEach(r => Object.assign(r, patch)); updates.push({ table, patch }) }
    return rows
  }
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    ilike: (c: string, p: string) => { preds.push(r => String(r[c]).toLowerCase() === p.toLowerCase()); return b },
    order: () => b,
    limit: () => b,
    update: (p: Row) => { patch = p; return b },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res),
  }
  return b
}
const client = { from: query }

const linkThreads = vi.fn(async (..._a: unknown[]) => undefined)
const recompute = vi.fn(async (..._a: unknown[]) => 'works_in_progress')
vi.mock('@/lib/jobs/fetchJobContext', () => ({ fetchJobContext: async () => ({}) }))
vi.mock('@/lib/jobs/getJobStage', () => ({
  getJobStage: () => ({ label: 'Awaiting approval', description: 'Report and quote sent to the insurer', primaryAction: { label: 'Chase insurer' }, contextualWarning: { message: 'Sent 9 days ago' } }),
}))
vi.mock('@/lib/jobs/recomputeStage', () => ({ recomputeAndSaveStage: (...a: unknown[]) => recompute(...a) }))
vi.mock('@/lib/excess/server', () => ({
  ExcessError: class extends Error {},
  loadExcessContext: async () => ({ applies: true, amount: 500, decision: 'collect', note: null, decidedAt: null, decidedByName: null, invoices: [] }),
}))
vi.mock('@/lib/signing/service', () => ({ listSigningRequestsForJob: async () => [] }))
vi.mock('@/lib/communications/thread-link', () => ({ linkOrderThreadsToJob: (...a: unknown[]) => linkThreads(...a) }))
vi.mock('@/lib/mcp/tools/documents', () => ({ listJobDocumentsTool: { run: async () => ({ text: 'IRC1062, 1 St:\n- Quote Q-IRC1062-1: sent, $8,450' }) } }))
vi.mock('@/lib/mcp/tools/emails', () => ({ listJobEmails: { run: async () => { throw new Error('gmail down') } } }))
vi.mock('@/lib/mcp/tools/work-orders', async (orig) => ({
  ...(await orig<object>()),
  findWorkOrders: { run: async () => ({ text: 'IRC1062, 1 St: 1 work orders, 1 not sent.\n- Painter, $1,010, not sent.' }) },
}))

const { getJobSummary, addJobNote } = await import('../tools/jobs')
const { updateInsurerOrder, linkOrderToJob } = await import('../tools/orders')

const ctx = { supabase: client as never, tenantId: 't1', userId: 'u1' }
const ORDER = '77777777-7777-7777-7777-777777777777'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  updates.length = 0
  db.jobs = [{ id: 'j62', tenant_id: 't1', job_number: 'IRC1062', property_address: '1 St', insured_name: 'Bruce Long', insured_phone: '0400 111 222', insurer: 'Castle', claim_number: 'CHCCLM010001697', notes: '1 Oct: Called Bruce' }]
  db.action_queue = [{ tenant_id: 't1', job_id: 'j62', status: 'pending', title: 'Chase quote approval', description: null, priority: 1 }]
  db.insurer_orders = [{ id: ORDER, tenant_id: 't1', status: 'pending', job_id: null, claim_number: null, wo_type: 'BAR', insured_name: 'Peter Laundy' }]
})

describe('get_job_summary', () => {
  it('leads with who, stage and next step, and keeps going when one part fails', async () => {
    const res = await getJobSummary.run({ job_number: 'IRC1062' }, ctx)
    expect(res.text).toMatch(/^IRC1062, 1 St\. Insured: Bruce Long \(0400 111 222\)\. Insurer: Castle, claim CHCCLM010001697\./)
    expect(res.text).toContain('Stage:\nAwaiting approval — Report and quote sent to the insurer Next step: Chase insurer. Note: Sent 9 days ago')
    expect(res.text).toContain('Waiting on you:\n- Chase quote approval')
    expect(res.text).toContain('Work orders:\n- Painter, $1,010, not sent.')
    expect(res.text).toContain('Documents:\n- Quote Q-IRC1062-1: sent, $8,450')
    expect(res.text).toContain('Excess:\nExcess $500 on file — Collecting excess.')
    expect(res.text).toContain('Latest emails:\n(couldn\'t load this part)')
    expect(res.text).toContain('Notes:\n1 Oct: Called Bruce')
  })
})

describe('add_job_note', () => {
  it('appends a dated voice line to the Overview notes', async () => {
    const res = await addJobNote.run({ job_number: 'IRC1062', note: ' Homeowner away until  the 5th ' }, ctx)
    expect(db.jobs[0].notes).toMatch(/^1 Oct: Called Bruce\n\d{1,2} \w{3} \d{4} \(voice\): Homeowner away until the 5th$/)
    expect(res.text).toMatch(/^Added to IRC1062's notes/)
    expect((await addJobNote.run({ job_number: 'IRC1062', note: ' ' }, ctx)).isError).toBe(true)
  })

  it('marks a note from the in-app assistant as such', async () => {
    await addJobNote.run({ job_number: 'IRC1062', note: 'Roofer booked' }, { ...ctx, via: 'chat' })
    expect(db.jobs[0].notes).toMatch(/\(assistant\): Roofer booked$/)
  })
})

describe('update_insurer_order', () => {
  it('adds a missing claim number (tidied) and reads the order back', async () => {
    const res = await updateInsurerOrder.run({ order_id: ORDER, claim_number: 'chcclm 0100 02035' }, ctx)
    expect(updates[0]).toEqual({ table: 'insurer_orders', patch: { claim_number: 'CHCCLM010002035' } })
    expect(res.text).toMatch(/^Updated \(Claim number: CHCCLM010002035\)\./)
  })

  it('checks the work type and excess, and won’t touch a lodged order', async () => {
    expect((await updateInsurerOrder.run({ order_id: ORDER, wo_type: 'roof' }, ctx)).isError).toBe(true)
    expect((await updateInsurerOrder.run({ order_id: ORDER, excess_building: -5 }, ctx)).isError).toBe(true)
    expect((await updateInsurerOrder.run({ order_id: ORDER }, ctx)).text).toBe('What should be changed on the order?')
    db.insurer_orders[0].job_id = 'j1'
    expect((await updateInsurerOrder.run({ order_id: ORDER, insured_name: 'X' }, ctx)).text).toMatch(/already lodged/)
    expect(updates).toHaveLength(0)
  })
})

describe('link_order_to_job', () => {
  it('links the order and its email thread to the existing job', async () => {
    const res = await linkOrderToJob.run({ order_id: ORDER, job_number: 'IRC1062' }, ctx)
    expect(updates[0]).toEqual({ table: 'insurer_orders', patch: { job_id: 'j62', status: 'lodged' } })
    expect(linkThreads).toHaveBeenCalledWith(client, 't1', ORDER, 'j62')
    expect(recompute).toHaveBeenCalledWith('j62')
    expect(res.text).toBe('Linked the order (no claim number) to IRC1062.')
  })
})
