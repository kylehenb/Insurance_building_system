import { describe, it, expect, vi, beforeEach } from 'vitest'

// Lodging an order: with skipAcknowledgement the job and everything its work
// type needs are created exactly as before and the office is notified, but no
// acknowledgement is emailed — a note on the job's Comms feed says it was
// skipped on purpose. Without it, the acknowledgement goes as before. What the
// order's checks found (no phone, landline only) and an acknowledgement held
// back because the office already replied are noted on the job too.

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
const services = vi.fn()
vi.mock('@/lib/jobs/services', () => ({ createServicesForOrder: (...a: unknown[]) => services(...a) }))

const { lodgeInsurerOrder } = await import('../lodge')
const supabase = { from: query } as never

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(db)) delete db[k]
  for (const k of Object.keys(inserted)) delete inserted[k]
  db.insurer_orders = [{
    id: 'o1', tenant_id: 't1', job_id: null, status: 'pending', claim_number: 'CLM1', wo_type: 'BAR', insurer: 'Castle', adjuster: null,
    property_address: '45 Randell Cres', insured_name: 'Peter Laundy', insured_phone: '0412 345 678', order_sender_email: 'claims@castle.com.au', order_sender_name: 'Casey', client_id: 'c1',
  }]
  db.tenants = [{ id: 't1', job_prefix: 'IRC', job_sequence: 1079 }]
  db.automation_config = []
  db.jobs = []
  db.users = [{ id: 'u1', tenant_id: 't1', name: 'Kyle' }]
  ack.mockResolvedValue({ sent: true, to: 'claims@castle.com.au' })
  invoice.mockResolvedValue({ invoiceRef: 'INV-1' })
  services.mockResolvedValue([])
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('lodgeInsurerOrder', () => {
  it('sets the KPI due dates from the insurer\'s own times, counted from when the order arrived', async () => {
    db.insurer_orders[0].created_at = '2026-10-29T02:00:00.000Z' // Thu 10am Perth
    db.clients = [{ id: 'c1', tenant_id: 't1', kpi_contact_hours: 4, kpi_booking_hours: 24, kpi_visit_days: 2, kpi_report_days: 1 }]
    await lodgeInsurerOrder(supabase, 'o1', { tenantId: 't1' })
    expect(inserted.jobs[0]).toMatchObject({
      kpi_started_at: '2026-10-29T02:00:00.000Z',
      kpi_contact_due: '2026-10-29T06:00:00.000Z',
      kpi_report_due: '2026-10-30T09:30:00.000Z', // by the end of Friday
    })
  })

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

  it('notes what the order\'s checks found on the job, saying whether the acknowledgement asked about it', async () => {
    db.insurer_orders[0].insured_phone = null
    const result = await lodgeInsurerOrder(supabase, 'o1', { tenantId: 't1' })
    expect(inserted.communications).toEqual([expect.objectContaining({
      job_id: result.jobId, type: 'note', source: 'order_checks',
      content: 'No phone number for the insured on the order. The acknowledgement asked the sender about it.',
    })])
  })

  it('notes a landline-only number as possibly the broker\'s, and an acknowledgement held back because the office already replied', async () => {
    db.insurer_orders[0].insured_phone = '(08) 9381 2200'
    ack.mockResolvedValue({ sent: false, alreadyReplied: true, skipped: 'The office already replied to claims@castle.com.au about this order on 28 Oct, 10:22 am' })
    await lodgeInsurerOrder(supabase, 'o1', { tenantId: 't1' })
    expect(inserted.communications.map(c => [c.source, c.content])).toEqual([
      ['order_acknowledgement_skipped', 'Order acknowledgement not emailed: The office already replied to claims@castle.com.au about this order on 28 Oct, 10:22 am.'],
      ['order_checks', 'The only phone number on the order is a landline ((08) 9381 2200). It may be the broker\'s rather than the insured\'s.'],
    ])
  })

  it('links to the job that already has the claim without acknowledging or noting, flag or not', async () => {
    db.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001', claim_number: 'CLM1' }]
    const result = await lodgeInsurerOrder(supabase, 'o1', { tenantId: 't1', skipAcknowledgement: true })
    expect(result).toMatchObject({ jobNumber: 'IRC1001', linkedToExisting: true })
    expect(ack).not.toHaveBeenCalled()
    expect(inserted.communications).toBeUndefined()
  })

  it('lodges a new claim at an address with an earlier job, noting the earlier job on the new one', async () => {
    db.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1037', claim_number: 'CLM0', property_address: '45 Randell Cres' }]
    const result = await lodgeInsurerOrder(supabase, 'o1', { tenantId: 't1' })
    expect(result).toMatchObject({ jobNumber: 'IRC1080', sameAddressJobs: [{ jobNumber: 'IRC1037', claimNumber: 'CLM0' }] })
    expect(inserted.jobs).toHaveLength(1)
    expect(ack).toHaveBeenCalled()
    expect(inserted.communications).toEqual([expect.objectContaining({
      job_id: result.jobId, type: 'note', source: 'order_same_address',
      content: 'Same address as job IRC1037 (claim CLM0).',
    })])
  })

  describe('what each work type creates', () => {
    const lodge = async (wo_types: string[]) => {
      db.insurer_orders[0].wo_types = wo_types
      return lodgeInsurerOrder(supabase, 'o1', { tenantId: 't1' })
    }

    it('BAR + make safe: the BAR\'s inspection, report, quote and invoice, and the make safe as a service to arrange', async () => {
      const result = await lodge(['make_safe', 'BAR'])
      expect(result.workTypes).toEqual(['make_safe', 'BAR'])
      expect(inserted.inspections).toHaveLength(1)
      expect(inserted.reports).toEqual([expect.objectContaining({ report_type: 'BAR', report_ref: 'BAR-IRC1080-1' })])
      expect(inserted.quotes).toEqual([expect.objectContaining({ inspection_id: inserted.inspections[0].id, report_id: inserted.reports[0].id })])
      expect(invoice).toHaveBeenCalledTimes(1)
      expect(invoice).toHaveBeenCalledWith(supabase, expect.objectContaining({ reportType: 'BAR' }))
      expect(services).toHaveBeenCalledWith(supabase, { tenantId: 't1', jobId: result.jobId, orderId: 'o1', types: ['make_safe', 'BAR'] })
    })

    it('make safe alone: no report or invoice made up front — just the service', async () => {
      await lodge(['make_safe'])
      expect(inserted.inspections).toBeUndefined()
      expect(inserted.reports).toBeUndefined()
      expect(inserted.quotes).toBeUndefined()
      expect(invoice).not.toHaveBeenCalled()
      expect(services).toHaveBeenCalledWith(supabase, expect.objectContaining({ types: ['make_safe'] }))
    })

    it('make safe + quote only: a quote and the make safe service', async () => {
      await lodge(['make_safe', 'quote_only'])
      expect(inserted.quotes).toEqual([expect.objectContaining({ inspection_id: null, report_id: null })])
      expect(inserted.reports).toBeUndefined()
      expect(services).toHaveBeenCalledWith(supabase, expect.objectContaining({ types: ['make_safe', 'quote_only'] }))
    })

    it('BAR + roof report: the BAR\'s records and a roof report service', async () => {
      await lodge(['BAR', 'roof_report'])
      expect(inserted.reports).toHaveLength(1)
      expect(services).toHaveBeenCalledWith(supabase, expect.objectContaining({ types: ['BAR', 'roof_report'] }))
    })

    it('reads an older order\'s single type, including "Quote Only" as it was once saved', async () => {
      db.insurer_orders[0].wo_type = 'Quote Only'
      await lodge([])
      expect(inserted.quotes).toHaveLength(1)
      expect(inserted.reports).toBeUndefined()
    })

    it('won\'t lodge an order with no work type, or one the app doesn\'t know', async () => {
      db.insurer_orders[0].wo_type = null
      await expect(lodge([])).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/work types/) })
      await expect(lodge(['variation'])).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/"variation"/) })
      expect(inserted.jobs).toBeUndefined()
    })

    it('a second order on a claim that has a job adds what\'s new to that job', async () => {
      db.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001', claim_number: 'CLM1' }]
      const result = await lodge(['make_safe'])
      expect(result).toMatchObject({ jobNumber: 'IRC1001', linkedToExisting: true })
      expect(services).toHaveBeenCalledWith(supabase, { tenantId: 't1', jobId: 'j1', orderId: 'o1', types: ['make_safe'] })
    })
  })
})
