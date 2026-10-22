import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fx from '@/lib/__tests__/print-documents.fixture'

// ── Fakes: Supabase (in-memory tables), Gmail, the PDF renderer ──────────

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const updates: { table: string; values: Row; filters: string[] }[] = []
const inserts: { table: string; row: Row }[] = []
const uploads: string[] = []

function query(table: string) {
  let rows = () => db[table] ?? []
  const filters: string[] = []
  const preds: ((r: Row) => boolean)[] = []
  let updateValues: Row | null = null
  const apply = () => rows().filter(r => preds.every(p => p(r)))
  const b: Record<string, unknown> = {
    select: () => b,
    order: () => b,
    limit: () => b,
    eq: (c: string, v: unknown) => { filters.push(`${c}=${v}`); preds.push(r => r[c] === v); return b },
    neq: (c: string, v: unknown) => { filters.push(`${c}!=${v}`); preds.push(r => r[c] !== v); return b },
    in: (c: string, vs: unknown[]) => { filters.push(`${c} in ${vs.join('|')}`); preds.push(r => vs.includes(r[c])); return b },
    is: (c: string, v: unknown) => { preds.push(r => (r[c] ?? null) === v); return b },
    update: (values: Row) => { updateValues = values; return b },
    insert: async (row: Row) => { inserts.push({ table, row }); return { error: null } },
    upsert: async () => ({ error: null }),
    single: async () => {
      const r = apply()
      return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { message: 'no rows' } }
    },
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      if (updateValues) {
        const hit = apply()
        hit.forEach(r => Object.assign(r, updateValues))
        updates.push({ table, values: updateValues, filters })
        return Promise.resolve({ data: hit, error: null }).then(res, rej)
      }
      return Promise.resolve({ data: apply(), error: null }).then(res, rej)
    },
  }
  return b
}

const fakeClient = {
  from: (t: string) => query(t),
  storage: { from: () => ({ upload: async (path: string) => { uploads.push(path); return { error: null } } }) },
}

const gmailSend = vi.fn(async (..._args: unknown[]) => ({ gmailId: 'g1', threadId: 't1' }))
const renderPdf = vi.fn(async (..._args: unknown[]) => Buffer.from('%PDF-fake'))
const recompute = vi.fn(async (..._args: unknown[]) => 'sent_awaiting_approval')
const markInvoiceSent = vi.fn(async (..._args: unknown[]) => undefined)

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => fakeClient, createClient: async () => fakeClient }))
vi.mock('@/lib/signing/email/gmail', () => ({ sendEmailViaGmail: (...a: unknown[]) => gmailSend(...a) }))
vi.mock('@/lib/documents/render-print-document', () => ({ renderPrintDocumentPdf: (...a: unknown[]) => renderPdf(...a) }))
vi.mock('@/lib/jobs/recomputeStage', () => ({ recomputeAndSaveStage: (...a: unknown[]) => recompute(...a) }))
vi.mock('@/lib/invoices/excess-invoice', () => ({ markInvoiceSent: (...a: unknown[]) => markInvoiceSent(...a) }))
vi.mock('@/lib/reports/similar-reports', () => ({ indexReports: async () => 0 }))
vi.mock('next/server', () => ({ after: () => undefined }))

const { buildDocumentEmailDraft, sendDocumentEmail, markDocumentsSentWithoutEmail, MAX_ATTACHMENT_BYTES } = await import('../email')
const { parseDocumentRef, DocumentSendError, invoiceDueText } = await import('../documents')

const CLIENT_ID = '00000000-0000-4000-8000-000000000501'
const ctx = { supabase: fakeClient as never, tenantId: fx.TENANT_ID, actorId: 'user-1' }
const quoteRef = { kind: 'quote' as const, id: fx.QUOTE_ID }

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  updates.length = 0
  inserts.length = 0
  uploads.length = 0
  vi.clearAllMocks()
  db.tenants = [fx.printTenant()]
  db.jobs = [fx.printJob({ client_id: CLIENT_ID })]
  db.clients = [{ id: CLIENT_ID, tenant_id: fx.TENANT_ID, submission_email: 'claims@insurer.example', adjuster_submission_email: 'reports@adjuster.example' }]
  db.quotes = [fx.printQuote()]
  db.scope_items = fx.printScopeItems()
  db.reports = [fx.printReport()]
  db.photos = fx.printPhotos(3)
  db.invoices = [fx.printInvoice()]
  db.invoice_line_items = fx.printInvoiceLines()
  db.invoice_deductions = []
})

describe('parseDocumentRef', () => {
  it('accepts the known kinds and rejects anything else', () => {
    expect(parseDocumentRef({ kind: 'quote', id: fx.QUOTE_ID })).toEqual(quoteRef)
    expect(() => parseDocumentRef({ kind: 'work_order', id: fx.QUOTE_ID })).toThrow(DocumentSendError)
    expect(() => parseDocumentRef({ kind: 'quote', id: 'not-a-uuid' })).toThrow(DocumentSendError)
    expect(() => parseDocumentRef({ kind: 'photos', id: fx.JOB_ID, photoIds: ['x'] })).toThrow(DocumentSendError)
  })

  it('keeps only the TCC call details it knows', () => {
    const ref = parseDocumentRef({ kind: 'tcc', id: fx.QUOTE_ID, tcc: { date: '1 Oct', completedBy: 'Sam', extra: 'x' } })
    expect(ref.tcc).toEqual({ date: '1 Oct', time: '', completedBy: 'Sam', method: '' })
  })
})

describe('buildDocumentEmailDraft', () => {
  it('addresses the order sender, copies the submission emails and fills the quote template', async () => {
    const draft = await buildDocumentEmailDraft([quoteRef], ctx)
    expect(draft.to).toBe('claims.officer@insurer.example')
    expect(draft.cc).toBe('reports@adjuster.example, claims@insurer.example')
    expect(draft.subject).toBe('Quote Q-IRC1234-1 - Claim CLM-555 <A&B> - Alex Example - 1 Example Street, Sampleton WA 6000')
    expect(draft.body).toMatch(/^Hi Casey,/)
    expect(draft.body).not.toMatch(/\{\w+\}/)
    expect(draft.attachments).toEqual([{ ref: quoteRef, filename: 'Quote - Q-IRC1234-1 - 1 Example Street, Sampleton WA 6000.pdf', title: 'Quote Q-IRC1234-1' }])
    expect(draft.usingBuiltInTemplate).toBe(true)
    expect(renderPdf).not.toHaveBeenCalled()
  })

  it('falls back to the adjuster submission email and "Hi team" without an order sender', async () => {
    db.jobs = [fx.printJob({ client_id: CLIENT_ID, order_sender_email: null })]
    const draft = await buildDocumentEmailDraft([quoteRef], ctx)
    expect(draft.to).toBe('reports@adjuster.example')
    expect(draft.cc).toBe('claims@insurer.example')
    expect(draft.body).toMatch(/^Hi team,/)
  })

  it('sends an excess invoice to the insured with the excess template', async () => {
    db.invoices = [fx.printInvoice({ invoice_type: 'excess', gst_treatment: 'inclusive', amount_inc_gst: 500 })]
    const draft = await buildDocumentEmailDraft([{ kind: 'invoice', id: fx.INVOICE_ID }], ctx)
    expect(draft.audience).toBe('insured')
    expect(draft.to).toBe('alex@example.com')
    expect(draft.cc).toBe('')
    expect(draft.body).toContain('Hi Alex,')
    expect(draft.body).toContain('excess of $500.00')
    expect(draft.body).toContain('due on receipt')
  })

  it('uses a client-specific template over the built-in one', async () => {
    db.email_templates = [{ id: 'tpl-1', tenant_id: fx.TENANT_ID, send_type: 'report', client_id: CLIENT_ID, name: 'Insurer X reports', subject_template: 'Report for {claim_number}', body_template: 'See attached {report_name}.', is_default: true }]
    const draft = await buildDocumentEmailDraft([{ kind: 'report', id: fx.printReport().id }], ctx)
    expect(draft.subject).toBe('Report for CLM-555 <A&B>')
    expect(draft.body).toBe('See attached Building Assessment Report.')
    expect(draft.templateName).toBe('Insurer X reports')
  })

  it('warns when there is no recipient and lists the job’s other documents', async () => {
    db.jobs = [fx.printJob({ client_id: null, order_sender_email: null })]
    const draft = await buildDocumentEmailDraft([quoteRef], ctx)
    expect(draft.to).toBe('')
    expect(draft.warnings[0]).toMatch(/No insurer email/)
    expect(draft.otherDocuments.map(d => d.title)).toEqual(['Building Assessment Report R-IRC1234-BAR', 'Invoice INV-IRC1234-1'])
  })

  it('refuses documents from different jobs in one email', async () => {
    db.reports = [fx.printReport({ job_id: '00000000-0000-4000-8000-000000000999' })]
    db.jobs.push(fx.printJob({ id: '00000000-0000-4000-8000-000000000999' }))
    await expect(buildDocumentEmailDraft([quoteRef, { kind: 'report', id: fx.printReport().id }], ctx))
      .rejects.toThrow('same job')
  })
})

describe('sendDocumentEmail', () => {
  it('emails every attachment, records it on the job and marks the documents sent', async () => {
    const reportRef = { kind: 'report' as const, id: fx.printReport().id }
    const result = await sendDocumentEmail([quoteRef, reportRef], ctx)

    expect(gmailSend).toHaveBeenCalledTimes(1)
    const email = gmailSend.mock.calls[0][1] as { to: string; cc: string; attachments: { filename: string }[] }
    expect(email.to).toBe('claims.officer@insurer.example')
    expect(email.cc).toBe('reports@adjuster.example, claims@insurer.example')
    expect(email.attachments.map(a => a.filename)).toEqual([
      'Quote - Q-IRC1234-1 - 1 Example Street, Sampleton WA 6000.pdf',
      'Building Assessment Report - R-IRC1234-BAR - 1 Example Street, Sampleton WA 6000.pdf',
    ])

    const comm = inserts.find(i => i.table === 'communications')!.row
    expect(comm).toMatchObject({ job_id: fx.JOB_ID, direction: 'outbound', source: 'document_send', contact_type: 'insurer', created_by: 'user-1', gmail_message_id: 'g1' })
    expect(uploads).toHaveLength(2)

    expect(db.quotes[0]).toMatchObject({ status: 'sent', is_locked: true })
    expect(db.reports[0]).toMatchObject({ status: 'sent', is_locked: true })
    expect(result.statusChanges.map(c => c.description)).toEqual(['Quote Q-IRC1234-1 marked sent', 'Building Assessment Report R-IRC1234-BAR marked sent'])
    expect(recompute).toHaveBeenCalledWith(fx.JOB_ID)
  })

  it('uses the customised recipients, subject and message', async () => {
    await sendDocumentEmail([quoteRef], ctx, { to: 'a@x.com; b@x.com', cc: 'a@x.com, c@x.com', subject: ' Custom ', body: 'Hello' })
    const email = gmailSend.mock.calls[0][1] as Record<string, unknown>
    expect(email).toMatchObject({ to: 'a@x.com, b@x.com', cc: 'c@x.com', subject: 'Custom', text: 'Hello' })
  })

  it('never moves a quote backwards (approved stays approved)', async () => {
    db.quotes = [fx.printQuote({ status: 'approved' })]
    const result = await sendDocumentEmail([quoteRef], ctx)
    expect(db.quotes[0].status).toBe('approved')
    expect(result.statusChanges).toEqual([])
  })

  it('marks only a draft invoice sent (and so syncs it to accounting)', async () => {
    await sendDocumentEmail([{ kind: 'invoice', id: fx.INVOICE_ID }], ctx)
    expect(markInvoiceSent).toHaveBeenCalledWith(fakeClient, fx.TENANT_ID, fx.INVOICE_ID)
    markInvoiceSent.mockClear()
    db.invoices = [fx.printInvoice({ status: 'paid' })]
    await sendDocumentEmail([{ kind: 'invoice', id: fx.INVOICE_ID }], ctx)
    expect(markInvoiceSent).not.toHaveBeenCalled()
  })

  it('changes nothing when Gmail fails', async () => {
    gmailSend.mockRejectedValueOnce(new Error('quota'))
    await expect(sendDocumentEmail([quoteRef], ctx)).rejects.toMatchObject({ status: 502 })
    expect(db.quotes[0].status).toBe('ready')
    expect(inserts).toHaveLength(0)
  })

  it('refuses invalid addresses, no recipient, and attachments too big to email', async () => {
    await expect(sendDocumentEmail([quoteRef], ctx, { to: 'nope' })).rejects.toThrow('not a valid email')
    await expect(sendDocumentEmail([quoteRef], ctx, { to: '' })).rejects.toMatchObject({ status: 422 })
    renderPdf.mockResolvedValueOnce(Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))
    await expect(sendDocumentEmail([quoteRef], ctx)).rejects.toMatchObject({ status: 413 })
    expect(gmailSend).not.toHaveBeenCalled()
  })

  it('refuses inbound (trade) and voided invoices', async () => {
    db.invoices = [fx.printInvoice({ direction: 'inbound' })]
    await expect(sendDocumentEmail([{ kind: 'invoice', id: fx.INVOICE_ID }], ctx)).rejects.toMatchObject({ status: 422 })
    db.invoices = [fx.printInvoice({ status: 'voided' })]
    await expect(sendDocumentEmail([{ kind: 'invoice', id: fx.INVOICE_ID }], ctx)).rejects.toMatchObject({ status: 409 })
  })
})

describe('markDocumentsSentWithoutEmail', () => {
  it('marks the quote sent and logs a note, without emailing', async () => {
    const result = await markDocumentsSentWithoutEmail([quoteRef], ctx)
    expect(gmailSend).not.toHaveBeenCalled()
    expect(renderPdf).not.toHaveBeenCalled()
    expect(db.quotes[0]).toMatchObject({ status: 'sent', is_locked: true })
    expect(result.statusChanges).toHaveLength(1)
    expect(inserts.find(i => i.table === 'communications')!.row).toMatchObject({ type: 'portal', source: 'document_send' })
  })
})

describe('invoiceDueText', () => {
  const tenant = { invoice_payment_terms: 14, excess_payment_terms: 0 }
  it('follows the tenant payment terms as the invoice does', () => {
    expect(invoiceDueText({ invoice_type: 'quoted_amounts', gst_treatment: 'exclusive', issued_date: '2026-10-20', created_at: null }, tenant)).toBe('3 Nov 2026')
    expect(invoiceDueText({ invoice_type: 'excess', gst_treatment: 'inclusive', issued_date: '2026-10-20', created_at: null }, tenant)).toBe('on receipt')
  })
})
