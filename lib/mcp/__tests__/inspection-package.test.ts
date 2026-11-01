import { describe, it, expect, vi, beforeEach } from 'vitest'

// Inspection package tools: which inspection, the preview and the send come
// from the app's own inspectionPackage / buildDocumentEmailDraft /
// sendDocumentEmail (always as a reply in the order thread, marking the
// inspection); the tools add choosing the inspection and refusing a resend.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}

function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  const apply = () => (db[table] ?? []).filter(r => preds.every(p => p(r)))
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    ilike: (c: string, p: string) => { preds.push(r => String(r[c]).toLowerCase() === p.toLowerCase()); return b },
    order: () => b,
    limit: () => b,
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: apply(), error: null }).then(res),
  }
  return b
}

class DocumentSendError extends Error {
  constructor(message: string, public readonly status: number) { super(message) }
}
const buildDraft = vi.fn()
const send = vi.fn()
const pkg = vi.fn()
vi.mock('@/lib/documents/send/documents', () => ({ DocumentSendError }))
vi.mock('@/lib/documents/send/email', () => ({
  buildDocumentEmailDraft: (...a: unknown[]) => buildDraft(...a),
  sendDocumentEmail: (...a: unknown[]) => send(...a),
}))
vi.mock('@/lib/documents/send/inspection-package', () => ({
  INSPECTION_SENT_STATUS: 'sent_and_locked',
  inspectionPackage: (...a: unknown[]) => pkg(...a),
}))

const { getInspectionPackage, sendInspectionPackage } = await import('../tools/inspection-package')
const { MCP_TOOLS } = await import('../tools/index')

const ctx = { supabase: { from: query } as never, tenantId: 't1', userId: 'u1' }
const DOCS = [{ kind: 'report', id: 'r1' }, { kind: 'quote', id: 'q1' }, { kind: 'invoice', id: 'i1' }]
const inspection = (id: string, ref: string, status = 'submitted') =>
  ({ id, tenant_id: 't1', job_id: 'j1', inspection_ref: ref, status, scheduled_date: '2026-10-20', created_at: id })

beforeEach(() => {
  vi.clearAllMocks()
  db.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001', property_address: '123 Test Street' }]
  db.inspections = [inspection('ins-1', 'INS-1')]
  pkg.mockResolvedValue({ inspection: { id: 'ins-1' }, documents: DOCS })
  buildDraft.mockResolvedValue({
    to: 'casey@insurer.example', cc: '', subject: 'Re: New order CLM-555', body: '<p>Hi Casey,</p>', bodyText: 'Hi Casey,',
    attachments: [
      { ref: DOCS[0], title: 'Building Assessment Report BAR-1', filename: 'BAR.pdf' },
      { ref: DOCS[1], title: 'Quote Q-1', filename: 'Q.pdf' },
      { ref: DOCS[2], title: 'Invoice INV-1', filename: 'INV.pdf' },
    ],
    audience: 'insurer', templateName: 'Report', usingBuiltInTemplate: true, warnings: [], otherDocuments: [],
    replyToOrder: { subject: 'Re: New order CLM-555' },
  })
  send.mockResolvedValue({ communicationId: 'c1', statusChanges: [{ ref: DOCS[0], description: 'Inspection INS-1 marked Sent and Locked' }] })
})

describe('registration', () => {
  it('registers both tools, the send behind the send permission', () => {
    const names = MCP_TOOLS.map(t => t.name)
    expect(names).toContain('get_inspection_package')
    expect(names).toContain('send_inspection_package')
    expect(sendInspectionPackage.permission).toBe('send.documents')
    expect(getInspectionPackage.annotations?.readOnlyHint).toBe(true)
  })
})

describe('get_inspection_package', () => {
  it('previews the package as a reply to the order email', async () => {
    const r = await getInspectionPackage.run({ job_number: 'irc1001' }, ctx)
    expect(r.isError).toBeFalsy()
    expect(pkg).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }), 'ins-1')
    expect(buildDraft).toHaveBeenCalledWith(DOCS, expect.anything(), { replyToOrder: true })
    expect(r.text).toContain('To: casey@insurer.example.')
    expect(r.text).toContain('Attachments: Building Assessment Report BAR-1, Quote Q-1, Invoice INV-1.')
    expect(r.text).toContain('reply in the insurer\'s order email thread')
    expect(r.data).toMatchObject({ inspection_ref: 'INS-1', reply_to_order: true, subject: 'Re: New order CLM-555' })
  })

  it('asks which inspection when there are several unsent ones', async () => {
    db.inspections = [inspection('ins-1', 'INS-1'), inspection('ins-2', 'INS-2')]
    const r = await getInspectionPackage.run({ job_number: 'IRC1001' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/2 inspections: INS-1 .*INS-2.*Which one/)
    expect(pkg).not.toHaveBeenCalled()
  })

  it('picks the only one not yet sent, or the one named', async () => {
    db.inspections = [inspection('ins-1', 'INS-1', 'sent_and_locked'), inspection('ins-2', 'INS-2')]
    await getInspectionPackage.run({ job_number: 'IRC1001' }, ctx)
    expect(pkg.mock.calls[0][1]).toBe('ins-2')
    await getInspectionPackage.run({ job_number: 'IRC1001', inspection_ref: 'ins-1' }, ctx)
    expect(pkg.mock.calls[1][1]).toBe('ins-1')
    const r = await getInspectionPackage.run({ job_number: 'IRC1001', inspection_ref: 'INS-9' }, ctx)
    expect(r).toMatchObject({ isError: true })
    expect(r.text).toContain('No inspection INS-9')
  })

  it('warns when the package has gone already, and passes on app errors', async () => {
    db.inspections = [inspection('ins-1', 'INS-1', 'sent_and_locked')]
    const r = await getInspectionPackage.run({ job_number: 'IRC1001' }, ctx)
    expect(r.text).toContain('already been sent')
    pkg.mockRejectedValueOnce(new DocumentSendError('Create the report and the quote for this inspection before sending the package.', 422))
    const e = await getInspectionPackage.run({ job_number: 'IRC1001' }, ctx)
    expect(e).toMatchObject({ isError: true, text: expect.stringContaining('Create the report and the quote') })
  })

  it('reports an unknown job and a job without inspections', async () => {
    expect((await getInspectionPackage.run({ job_number: 'IRC9999' }, ctx)).isError).toBe(true)
    db.inspections = []
    const r = await getInspectionPackage.run({ job_number: 'IRC1001' }, ctx)
    expect(r.text).toBe('IRC1001 has no inspections.')
  })
})

describe('send_inspection_package', () => {
  it('sends in the order thread and marks the inspection', async () => {
    const r = await sendInspectionPackage.run({ job_number: 'IRC1001' }, ctx)
    expect(r.isError).toBeFalsy()
    expect(send).toHaveBeenCalledWith(DOCS, expect.objectContaining({ actorId: 'u1' }), expect.objectContaining({ replyToOrder: true, inspectionId: 'ins-1' }))
    expect(r.text).toBe('Emailed Building Assessment Report BAR-1, Quote Q-1, Invoice INV-1 to casey@insurer.example as a reply to the order email. Inspection INS-1 marked Sent and Locked.')
  })

  it('passes on the user\'s changes', async () => {
    await sendInspectionPackage.run({ job_number: 'IRC1001', to: 'other@insurer.example', cc: '', body: 'Hi,\n\nAttached.\n\n{signature}' }, ctx)
    expect(send.mock.calls[0][2]).toMatchObject({ to: 'other@insurer.example', cc: '', body: 'Hi,\n\nAttached.\n\n{signature}', subject: undefined })
  })

  it('refuses a package already sent unless resend is confirmed', async () => {
    db.inspections = [inspection('ins-1', 'INS-1', 'sent_and_locked')]
    const r = await sendInspectionPackage.run({ job_number: 'IRC1001' }, ctx)
    expect(r).toMatchObject({ isError: true, text: expect.stringContaining('already been sent') })
    expect(send).not.toHaveBeenCalled()
    await sendInspectionPackage.run({ job_number: 'IRC1001', resend: true }, ctx)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('reports a send error instead of throwing', async () => {
    send.mockRejectedValueOnce(new DocumentSendError('Failed to send the email. Nothing was sent or changed.', 502))
    const r = await sendInspectionPackage.run({ job_number: 'IRC1001' }, ctx)
    expect(r).toMatchObject({ isError: true, text: 'Failed to send the email. Nothing was sent or changed.' })
  })
})
