import { describe, it, expect, vi, beforeEach } from 'vitest'

// Lodging an order: with skipAcknowledgement the job and everything its work
// type needs are created exactly as before and the office is notified, but no
// acknowledgement is emailed — a note on the job's Comms feed says it was
// skipped on purpose. Without it, the acknowledgement goes as before.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const inserted: Record<string, Row[]> = {}
let nextId = 0
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  let pending: Row | null = null
  let patch: Row | null = null
  const apply = () => (db[table] ?? []).filter(r => preds.every(p => p(r)))
  const result = () => {
    if (pending) return { data: pending, error: null }
    if (patch) { apply().forEach(r => Object.assign(r, patch)); return { data: null, error: null } }
    return { data: apply(), error: null }
  }
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    neq: (c: string, v: unknown) => { preds.push(r => r[c] !== v); return b },
    in: (c: string, v: unknown[]) => { preds.push(r => v.includes(r[c])); return b },
    like: (c: string, p: string) => { const needle = p.replace(/%/g, ''); preds.push(r => String(r[c] ?? '').includes(needle)); return b },
    insert: (row: Row) => {
      pending = { id: `${table}-${++nextId}`, ...row }
      ;(db[table] ??= []).push(pending)
      ;(inserted[table] ??= []).push(pending)
      return b
    },
    update: (row: Row) => { patch = row; return b },
    single: async () => {
      if (pending) return { data: pending, error: null }
      const row = apply()[0]
      return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } }
    },
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
  }
  return b
}

const ack = vi.fn()
const notify = vi.fn()
const invoice = vi.fn()
vi.mock('@/lib/email/order-acknowledgement', () => ({ sendOrderAcknowledgement: (...a: unknown[]) => ack(...a) }))
vi.mock('@/lib/email/notify-job-approved', () => ({ notifyJobApproved: (...a: unknown[]) => notify(...a) }))
vi.mock('@/lib/invoices/report-to-invoice', () => ({ createInvoiceForReport: (...a: unknown[]) => invoice(...a) }))
vi.mock('@/lib/jobs/recomputeStage', () => ({ recomputeAndSaveStage: async () => {} }))
vi.mock('@/lib/communications/thread-link', () => ({ linkOrderThreadsToJob: async () => {} }))
vi.mock('@/lib/clients/resolve-insurer', () => ({ resolveInsurerClient: async () => null }))

const { lodgeInsurerOrder } = await import('../lodge')
const supabase = { from: query } as never

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(db)) delete db[k]
  for (const k of Object.keys(inserted)) delete inserted[k]
  db.insurer_orders = [{
    id: 'o1', tenant_id: 't1', job_id: null, status: 'pending', claim_number: 'CLM1', wo_type: 'BAR', insurer: 'Castle', adjuster: null,
    property_address: '45 Randell Cres', insured_name: 'Peter Laundy', order_sender_email: 'claims@castle.com.au', order_sender_name: 'Casey', client_id: 'c1',
  }]
  db.tenants = [{ id: 't1', job_prefix: 'IRC', job_sequence: 1079 }]
  db.automation_config = []
  db.jobs = []
  db.users = [{ id: 'u1', tenant_id: 't1', name: 'Kyle' }]
  ack.mockResolvedValue({ sent: true, to: 'claims@castle.com.au' })
  invoice.mockResolvedValue({ invoiceRef: 'INV-1' })
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('lodgeInsurerOrder', () => {
  it('emails the acknowledgement as before when not asked to skip it', async () => {
    const result = await lodgeInsurerOrder(supabase, 'o1', { tenantId: 't1' })
    expect(result).toMatchObject({ jobNumber: 'IRC1080', acknowledgement: { sent: true, to: 'claims@castle.com.au' } })
    expect(ack).toHaveBeenCalledWith(supabase, { tenantId: 't1', orderId: 'o1', jobId: result.jobId })
    expect(inserted.communications).toBeUndefined()
  })

  it('with skipAcknowledgement creates the same records, notifies the office, sends nothing and notes the skip', async () => {
    const result = await lodgeInsurerOrder(supabase, 'o1', { tenantId: 't1', userId: 'u1', skipAcknowledgement: true })
    expect(result).toMatchObject({ jobNumber: 'IRC1080', acknowledgement: { sent: false, skipped: 'Skipped on purpose when lodging' } })
    expect(ack).not.toHaveBeenCalled()

    expect(inserted.jobs).toHaveLength(1)
    expect(inserted.jobs[0]).toMatchObject({ job_number: 'IRC1080', claim_number: 'CLM1', kpi_contact_due: expect.any(String), kpi_report_due: expect.any(String) })
    expect(inserted.inspections).toHaveLength(1)
    expect(inserted.reports).toHaveLength(1)
    expect(inserted.quotes).toHaveLength(1)
    expect(invoice).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ jobId: result.jobId, jobNumber: 'IRC1080' }))
    expect(db.insurer_orders[0]).toMatchObject({ job_id: result.jobId, status: 'lodged' })

    expect(inserted.communications).toEqual([expect.objectContaining({
      tenant_id: 't1', job_id: result.jobId, type: 'note', contact_name: 'Kyle', created_by: 'u1', source: 'order_acknowledgement_skipped',
      content: 'Order acknowledgement not emailed to claims@castle.com.au: skipped on purpose when the order was lodged.',
    })])
  })

  it('links to the job that already has the claim without acknowledging or noting, flag or not', async () => {
    db.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001', claim_number: 'CLM1' }]
    const result = await lodgeInsurerOrder(supabase, 'o1', { tenantId: 't1', skipAcknowledgement: true })
    expect(result).toMatchObject({ jobNumber: 'IRC1001', linkedToExisting: true })
    expect(ack).not.toHaveBeenCalled()
    expect(inserted.communications).toBeUndefined()
  })
})
