import { describe, it, expect, vi, beforeEach } from 'vitest'

// Send & Lock attaches the job's photos PDF by default.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const inserts: Row[] = []

function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  let head = false
  let patch: Row | null = null
  const apply = () => (db[table] ?? []).filter(r => preds.every(p => p(r)))
  const b: Record<string, unknown> = {
    select: (_c: string, o?: { head?: boolean }) => { head = !!o?.head; return b },
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    // Only the shape the send claim uses: "<col>.is.null,<col>.like.<prefix>*"
    or: (expr: string) => {
      const [, col, prefix] = expr.match(/^(\w+)\.is\.null,\w+\.like\.(\w+)\*$/) ?? []
      preds.push(r => r[col] == null || String(r[col]).startsWith(prefix))
      return b
    },
    // Applied when awaited, like a real update: matching rows change and come back
    update: (p: Row) => { patch = p; return b },
    upsert: async () => ({ error: null }),
    insert: async (row: Row) => { inserts.push(row); return { error: null } },
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => {
      const rows = apply()
      if (patch) rows.forEach(r => Object.assign(r, patch))
      return Promise.resolve(head ? { count: rows.length, error: null } : { data: rows, error: null }).then(res)
    },
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

describe('work order send claim', () => {
  it('locks the work order once Gmail accepts the email', async () => {
    await sendWorkOrderEmail('wo1', ctx)
    expect(db.work_orders[0]).toMatchObject({ gary_state: 'waiting_reply', status: 'engaged' })
  })

  it('lets only one of two simultaneous sends email the trade', async () => {
    const results = await Promise.allSettled([sendWorkOrderEmail('wo1', ctx), sendWorkOrderEmail('wo1', ctx)])
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(failed.reason).toMatchObject({ status: 409 })
    expect(gmailSend).toHaveBeenCalledTimes(1)
    expect(inserts).toHaveLength(1)
  })

  it('releases the work order if Gmail refuses the email', async () => {
    gmailSend.mockRejectedValueOnce(new Error('gmail down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(sendWorkOrderEmail('wo1', ctx)).rejects.toMatchObject({ status: 502 })
    expect(db.work_orders[0]).toMatchObject({ gary_state: 'not_started', status: 'pending' })
    await sendWorkOrderEmail('wo1', ctx)
    expect(db.work_orders[0].gary_state).toBe('waiting_reply')
  })
})
