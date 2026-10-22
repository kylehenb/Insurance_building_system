import { describe, it, expect, vi, beforeEach } from 'vitest'

// Document tools: the list, preview and send come from the app's own send
// dialog functions; the tools add what voice needs — status and amounts,
// "already emailed" warnings, and refusing an accidental repeat send.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}

function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  let head = false
  const apply = () => (db[table] ?? []).filter(r => preds.every(p => p(r)))
  const b: Record<string, unknown> = {
    select: (_c: string, o?: { head?: boolean }) => { head = !!o?.head; return b },
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    in: (c: string, vs: unknown[]) => { preds.push(r => vs.includes(r[c])); return b },
    gte: (c: string, v: string) => { preds.push(r => String(r[c]) >= v); return b },
    ilike: (c: string, p: string) => { preds.push(r => String(r[c]).toLowerCase() === p.toLowerCase()); return b },
    order: () => b,
    limit: () => b,
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve(head ? { count: apply().length, error: null } : { data: apply(), error: null }).then(res),
  }
  return b
}

class DocumentSendError extends Error {
  constructor(message: string, public readonly status: number) { super(message) }
}
const buildDraft = vi.fn()
const send = vi.fn()
vi.mock('@/lib/documents/send/documents', () => ({
  DocumentSendError,
  parseDocumentRef: (o: { kind?: string; id?: string }) => {
    if (!['quote', 'report', 'invoice', 'tcc', 'photos'].includes(o?.kind ?? '')) throw new DocumentSendError('Unknown document type', 400)
    return { kind: o.kind, id: o.id }
  },
  quoteDocumentTotal: (_q: unknown, items: unknown[]) => items.length * 1100,
}))
vi.mock('@/lib/documents/send/email', () => ({
  buildDocumentEmailDraft: (...a: unknown[]) => buildDraft(...a),
  sendDocumentEmail: (...a: unknown[]) => send(...a),
  listJobDocuments: async () => [
    { ref: { kind: 'quote', id: 'q1' }, title: 'Quote Q-IRC1001-7', filename: '' },
    { ref: { kind: 'report', id: 'r1' }, title: 'Building Assessment Report BAR-IRC1001-5', filename: '' },
    { ref: { kind: 'invoice', id: 'i1' }, title: 'Excess invoice INV-IRC1001-1', filename: '' },
  ],
}))

const { listJobDocumentsTool, getDocumentEmail, sendDocuments } = await import('../tools/documents')

const ctx = { supabase: { from: query } as never, tenantId: 't1', userId: 'u1' }
const QUOTE = { kind: 'quote', id: 'q1' }
const REPORT = { kind: 'report', id: 'r1' }
const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString()
const email = (at: string, to: string, files: string[]) =>
  ({ tenant_id: 't1', job_id: 'j1', source: 'document_send', type: 'email', created_at: at, to_email: to, subject: 'Docs', attachments: files.map(filename => ({ filename })) })

beforeEach(() => {
  vi.clearAllMocks()
  db.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001', property_address: '123 Test Street', insured_name: 'Smith' }]
  db.quotes = [{ id: 'q1', tenant_id: 't1', job_id: 'j1', status: 'approved', created_at: '2026-10-12T02:00:00Z' }]
  db.scope_items = [{ id: 's1', tenant_id: 't1', quote_id: 'q1' }, { id: 's2', tenant_id: 't1', quote_id: 'q1' }]
  db.reports = [{ id: 'r1', tenant_id: 't1', job_id: 'j1', status: 'complete', created_at: '2026-10-14T02:00:00Z' }]
  db.invoices = [{ id: 'i1', tenant_id: 't1', job_id: 'j1', status: 'sent', amount_inc_gst: 500, created_at: '2026-10-15T02:00:00Z' }]
  db.photos = [{ id: 'p1', tenant_id: 't1', job_id: 'j1' }, { id: 'p2', tenant_id: 't1', job_id: 'j1' }]
  db.communications = [email(minutesAgo(3 * 24 * 60), 'claims@insurer.example', ['BAR-IRC1001-5.pdf'])]
  buildDraft.mockResolvedValue({
    to: 'claims@insurer.example', cc: 'adjuster@example.com', subject: 'IRC1001 report and quote', body: 'Hi team,\n\nPlease find attached…',
    attachments: [
      { ref: REPORT, title: 'Building Assessment Report BAR-IRC1001-5', filename: 'BAR-IRC1001-5.pdf' },
      { ref: QUOTE, title: 'Quote Q-IRC1001-7', filename: 'Q-IRC1001-7.pdf' },
    ],
    audience: 'insurer', templateName: 'Report — default', usingBuiltInTemplate: true,
    warnings: [], otherDocuments: [{ ref: { kind: 'invoice', id: 'i1' }, title: 'Excess invoice INV-IRC1001-1', filename: '' }],
  })
  send.mockResolvedValue({ communicationId: 'c1', statusChanges: [{ ref: QUOTE, description: 'Quote Q-IRC1001-7 marked sent' }] })
})

describe('list_job_documents', () => {
  it('lists documents with status and amount, the photos, and recent emails', async () => {
    const res = await listJobDocumentsTool.run({ job_number: 'irc 1001' }, ctx)
    expect(res.text).toContain('- Quote Q-IRC1001-7: approved, $2,200')
    expect(res.text).toContain('- Building Assessment Report BAR-IRC1001-5: complete')
    expect(res.text).toContain('- Excess invoice INV-IRC1001-1: sent, $500')
    expect(res.text).toContain('- Photos: 2.')
    expect(res.text).toMatch(/Recent document emails: .* to claims@insurer\.example \(BAR-IRC1001-5\.pdf\)/)
    expect(res.data).toMatchObject({ photos: { document: { kind: 'photos', id: 'j1' }, count: 2 } })
  })

  it('suggests close job numbers', async () => {
    const res = await listJobDocumentsTool.run({ job_number: 'IRC9999' }, ctx)
    expect(res.isError).toBe(true)
  })
})

describe('get_document_email', () => {
  it('reads back recipients and attachments, and warns about an earlier email', async () => {
    const res = await getDocumentEmail.run({ documents: [REPORT, QUOTE] }, ctx)
    expect(buildDraft).toHaveBeenCalledWith([REPORT, QUOTE], { supabase: ctx.supabase, tenantId: 't1', actorId: 'u1' })
    expect(res.text).toContain('To: claims@insurer.example. Cc: adjuster@example.com.')
    expect(res.text).toContain('Attachments: Building Assessment Report BAR-IRC1001-5, Quote Q-IRC1001-7.')
    expect(res.text).toMatch(/Building Assessment Report BAR-IRC1001-5 was already emailed on .* to claims@insurer\.example\./)
    expect(res.text).toContain('Could also attach: Excess invoice INV-IRC1001-1.')
  })

  it('refuses a malformed document list', async () => {
    expect((await getDocumentEmail.run({ documents: [] }, ctx)).isError).toBe(true)
    expect((await getDocumentEmail.run({ documents: [{ kind: 'contract', id: 'x' }] }, ctx)).isError).toBe(true)
    expect(buildDraft).not.toHaveBeenCalled()
  })
})

describe('send_documents', () => {
  it('sends through the app’s send function and reports what changed', async () => {
    const res = await sendDocuments.run({ documents: [REPORT, QUOTE] }, ctx)
    expect(send).toHaveBeenCalledWith([REPORT, QUOTE], { supabase: ctx.supabase, tenantId: 't1', actorId: 'u1' },
      { to: undefined, cc: undefined, subject: undefined, body: undefined })
    expect(res.text).toBe('Emailed Building Assessment Report BAR-IRC1001-5, Quote Q-IRC1001-7 to claims@insurer.example. Quote Q-IRC1001-7 marked sent.')
  })

  it('passes the user’s recipients and wording', async () => {
    await sendDocuments.run({ documents: [QUOTE], to: 'kyle@example.com', cc: '', body: 'Custom' }, ctx)
    expect(send).toHaveBeenCalledWith([QUOTE], expect.anything(), { to: 'kyle@example.com', cc: '', subject: undefined, body: 'Custom' })
  })

  it('refuses the same documents to the same people minutes later, unless told to resend', async () => {
    db.communications.push(email(minutesAgo(2), 'Claims@Insurer.example, adjuster@example.com', ['BAR-IRC1001-5.pdf', 'Q-IRC1001-7.pdf']))
    const res = await sendDocuments.run({ documents: [REPORT, QUOTE] }, ctx)
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/^Not sent: .* went to Claims@Insurer\.example, adjuster@example\.com 2 minutes ago\./)
    expect(send).not.toHaveBeenCalled()

    await sendDocuments.run({ documents: [REPORT, QUOTE], resend: true }, ctx)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does not treat an older send, or a send to someone else, as a repeat', async () => {
    db.communications.push(email(minutesAgo(30), 'claims@insurer.example', ['BAR-IRC1001-5.pdf', 'Q-IRC1001-7.pdf']))
    db.communications.push(email(minutesAgo(1), 'kyle@example.com', ['BAR-IRC1001-5.pdf', 'Q-IRC1001-7.pdf']))
    await sendDocuments.run({ documents: [REPORT, QUOTE] }, ctx)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('passes on the app’s refusal', async () => {
    send.mockRejectedValueOnce(new DocumentSendError('This invoice has been voided', 409))
    const res = await sendDocuments.run({ documents: [{ kind: 'invoice', id: 'i1' }] }, ctx)
    expect(res).toMatchObject({ text: 'This invoice has been voided', isError: true })
  })
})
