import { describe, it, expect, vi, beforeEach } from 'vitest'

// Send & Lock attaches the job's photos PDF by default.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const inserts: Row[] = []

function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  let head = false
  const apply = () => (db[table] ?? []).filter(r => preds.every(p => p(r)))
  const b: Record<string, unknown> = {
    select: (_c: string, o?: { head?: boolean }) => { head = !!o?.head; return b },
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    update: () => b,
    upsert: async () => ({ error: null }),
    insert: async (row: Row) => { inserts.push(row); return { error: null } },
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve(head ? { count: apply().length, error: null } : { data: apply(), error: null }).then(res),
  }
  return b
}
const client = { from: query, storage: { from: () => ({ upload: async () => ({ error: null }) }) } }

const gmailSend = vi.fn(async (_req: unknown) => ({ data: { id: 'g1', threadId: 't1' } }))
const buildPhotos = vi.fn(async (..._a: unknown[]) => ({ pdf: Buffer.from('photos'), filename: 'Photos - IRC1 - 1 Example St.pdf' }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => client, createClient: async () => client }))
vi.mock('@/lib/gmail/client', () => ({ getGmailClient: () => ({ users: { messages: { send: gmailSend } } }) }))
vi.mock('@/lib/work-orders/work-order-pdf', () => ({
  buildWorkOrderPdf: async () => ({ pdf: Buffer.from('wo'), filename: 'WO-1 - Plaster Co - 1 Example St.pdf', isSent: true }),
  tradeLabelFor: () => 'Plasterer',
}))
vi.mock('@/lib/documents/print-document-pdfs', () => ({
  buildPhotosPdf: (...a: unknown[]) => buildPhotos(...a),
  photosPdfFilename: () => 'Photos - IRC1 - 1 Example St.pdf',
}))

const { buildWorkOrderEmailDraft, sendWorkOrderEmail } = await import('../work-order-email')
const ctx = { supabase: client as never, tenantId: 't1' }

const attachmentNames = () => {
  const raw = (gmailSend.mock.calls[0][0] as { requestBody: { raw: string } }).requestBody.raw
  return [...Buffer.from(raw, 'base64url').toString().matchAll(/filename="([^"]+)"/g)].map(m => m[1])
}

beforeEach(() => {
  vi.clearAllMocks()
  inserts.length = 0
  db.work_orders = [{ id: 'wo1', tenant_id: 't1', job_id: 'j1', trade_id: 'tr1', work_order_ref: 'WO-1', gary_state: 'not_started', status: 'pending', predecessor_work_order_id: null }]
  db.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1', property_address: '1 Example St', client_id: null }]
  db.tenants = [{ id: 't1', name: 'IRC', trading_name: null, contact_email: 'office@example.com' }]
  db.trades = [{ id: 'tr1', tenant_id: 't1', business_name: 'Plaster Co', contact_email: 'plaster@example.com' }]
  db.photos = [{ id: 'p1', job_id: 'j1', tenant_id: 't1' }, { id: 'p2', job_id: 'j1', tenant_id: 't1' }]
})

describe('work order email photos', () => {
  it('offers the job photos in the draft', async () => {
    const draft = await buildWorkOrderEmailDraft('wo1', ctx)
    expect(draft.photos).toEqual({ count: 2, attachmentName: 'Photos - IRC1 - 1 Example St.pdf', jobId: 'j1' })
  })

  it('attaches the photos PDF by default and records both copies', async () => {
    await sendWorkOrderEmail('wo1', ctx)
    expect(buildPhotos).toHaveBeenCalledWith('j1', [], ctx)
    expect(attachmentNames()).toEqual(['WO-1 - Plaster Co - 1 Example St.pdf', 'Photos - IRC1 - 1 Example St.pdf'])
    expect((inserts[0].attachments as unknown[]).length).toBe(2)
  })

  it('leaves the photos off when asked, or when the job has none', async () => {
    await sendWorkOrderEmail('wo1', ctx, { includePhotos: false })
    expect(attachmentNames()).toEqual(['WO-1 - Plaster Co - 1 Example St.pdf'])
    gmailSend.mockClear()
    db.photos = []
    db.work_orders[0].gary_state = 'not_started'
    await sendWorkOrderEmail('wo1', ctx)
    expect(buildPhotos).not.toHaveBeenCalled()
    expect(attachmentNames()).toEqual(['WO-1 - Plaster Co - 1 Example St.pdf'])
  })

  it('sends nothing if the photos PDF fails', async () => {
    buildPhotos.mockRejectedValueOnce(new Error('boom'))
    await expect(sendWorkOrderEmail('wo1', ctx)).rejects.toThrow(/photos PDF/)
    expect(gmailSend).not.toHaveBeenCalled()
  })
})
