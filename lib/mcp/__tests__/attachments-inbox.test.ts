import { describe, it, expect, vi, beforeEach } from 'vitest'

// Reading an email's attachments (stored copy first, Gmail otherwise), saving
// an inbox email the app never recorded, and putting an email on a job.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const updates: Row[] = []
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  let patch: Row | null = null
  const apply = () => (db[table] ?? []).filter(r => preds.every(p => p(r)))
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    ilike: (c: string, p: string) => { preds.push(r => String(r[c]).toLowerCase() === p.toLowerCase()); return b },
    limit: () => b,
    update: (p: Row) => { patch = p; return b },
    single: async () => { const r = apply()[0]; if (r && patch) { Object.assign(r, patch); updates.push(patch) } return { data: r ?? null, error: null } },
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: apply(), error: null }).then(res),
  }
  return b
}
const download = vi.fn(async (path: string) => ({ data: new Blob([`bytes of ${path}`]), error: null }))
const client = { from: query, storage: { from: () => ({ download }) } }

const read = vi.fn(async (f: { filename: string; data: Buffer }) => ({ text: `Summary: ${f.filename} says ${f.data.toString()}`, method: 'claude', truncated: false }))
const gmailList = vi.fn()
const extract = vi.fn()
const insertLinked = vi.fn()
const upload = vi.fn(async (..._a: unknown[]) => [{ filename: 'remittance.pdf', storage_path: 'p', mime_type: 'application/pdf', size_bytes: 10 }])
const linkThread = vi.fn(async (..._a: unknown[]) => 2)
vi.mock('@/lib/attachments/read', async (orig) => ({ ...(await orig<object>()), readAttachment: (f: never) => read(f) }))
vi.mock('@/lib/gmail/client', () => ({ getGmailClient: () => ({ users: { messages: { list: gmailList } } }) }))
vi.mock('@/lib/gmail/messages', () => ({ getFullMessage: async (id: string) => ({ id }), extractMessageParts: (m: { id: string }) => extract(m.id) }))
vi.mock('@/lib/communications/inbound-email', () => ({
  // recordInboxMessage's own steps, on the mocks above
  recordInboxMessage: async (db: unknown, tenantId: string, messageId: string, msg: { attachments?: unknown[] }) => {
    const emailId = 'new-email-id'
    const stored = msg.attachments?.length ? await upload(msg.attachments, tenantId, emailId, db, messageId) : []
    const link = await insertLinked(db, tenantId, emailId, msg, stored)
    return { emailId, link, msg, stored }
  },
}))
vi.mock('@/lib/communications/thread-link', () => ({ linkThreadToJob: (...a: unknown[]) => linkThread(...a) }))

const { readEmailAttachment } = await import('../tools/attachments')
const { saveEmail, linkEmailToJob } = await import('../tools/inbox')

const ctx = { supabase: client as never, tenantId: 't1', userId: 'u1' }
const E1 = '66666666-6666-6666-6666-666666666666'
const castleMsg = (over: Row = {}) => ({
  messageId: 'gm123456', threadId: 'th9', gmailMessageId: '<rem@castle>', subject: 'Remittance advice – INV-IRC1010-3', fromEmail: 'castleinsurance.mailer@primeeco.tech',
  attachments: [{ filename: 'remittance.pdf', mimeType: 'application/pdf', data: Buffer.from('paid $1,000').toString('base64'), size: 11 }], ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  updates.length = 0
  db.jobs = [{ id: 'j10', tenant_id: 't1', job_number: 'IRC1010', property_address: '1 St', insured_name: 'A' }, { id: 'j1', tenant_id: 't1', job_number: 'IRC1001', property_address: '2 St', insured_name: 'B' }]
  db.communications = [{
    id: E1, tenant_id: 't1', type: 'email', subject: 'Instructions', gmail_message_id: '<abc@insurer>', job_id: 'j1', thread_id: 'th1',
    attachments: [
      { filename: 'Instruction Sheet.pdf', storage_path: 'tenants/t1/comms/x/1-Instruction_Sheet.pdf', mime_type: 'application/pdf', size_bytes: 200_000 },
      { filename: 'photo.jpg', storage_path: 'tenants/t1/comms/x/2-photo.jpg', mime_type: 'image/jpeg', size_bytes: 2_500_000 },
    ],
  }]
  extract.mockResolvedValue(castleMsg())
  insertLinked.mockResolvedValue({ job_id: 'j10', source: 'auto_linked', match_candidates: null })
})

describe('read_email_attachment', () => {
  it('asks which attachment when there are several', async () => {
    const res = await readEmailAttachment.run({ email_id: E1 }, ctx)
    expect(res.text).toBe('"Instructions" has 2 attachments — which one?\n1. Instruction Sheet.pdf (195 KB)\n2. photo.jpg (2.4 MB)')
    expect(read).not.toHaveBeenCalled()
  })

  it('reads the chosen one from the stored copy, by number or name', async () => {
    const res = await readEmailAttachment.run({ email_id: E1, attachment: '1' }, ctx)
    expect(download).toHaveBeenCalledWith('tenants/t1/comms/x/1-Instruction_Sheet.pdf')
    expect(res.text).toBe('Instruction Sheet.pdf:\nSummary: Instruction Sheet.pdf says bytes of tenants/t1/comms/x/1-Instruction_Sheet.pdf')
    await readEmailAttachment.run({ email_id: E1, attachment: 'photo' }, ctx)
    expect(read.mock.calls[1][0]).toMatchObject({ filename: 'photo.jpg', mimeType: 'image/jpeg' })
  })

  it('falls back to Gmail when the app has no stored copy', async () => {
    db.communications[0].attachments = []
    gmailList.mockResolvedValue({ data: { messages: [{ id: 'gm123456' }] } })
    const res = await readEmailAttachment.run({ email_id: E1 }, ctx)
    expect(gmailList).toHaveBeenCalledWith(expect.objectContaining({ q: 'rfc822msgid:abc@insurer' }))
    expect(res.text).toBe('remittance.pdf:\nSummary: remittance.pdf says paid $1,000')
  })

  it('reads an inbox email by its Gmail id, and says when there’s nothing to read', async () => {
    expect((await readEmailAttachment.run({ message_id: 'gm123456' }, ctx)).text).toMatch(/^remittance\.pdf:/)
    extract.mockResolvedValueOnce(castleMsg({ attachments: [] }))
    expect((await readEmailAttachment.run({ message_id: 'gm123456' }, ctx)).text).toBe('"Remittance advice – INV-IRC1010-3" has no attachments.')
    expect((await readEmailAttachment.run({}, ctx)).isError).toBe(true)
  })
})

describe('save_email', () => {
  it('saves an unrecorded inbox email with its attachments, matched to its job', async () => {
    const res = await saveEmail.run({ message_id: 'gm123456' }, ctx)
    expect(upload).toHaveBeenCalledWith(expect.any(Array), 't1', expect.any(String), client, 'gm123456')
    expect(insertLinked).toHaveBeenCalledWith(client, 't1', expect.any(String), expect.objectContaining({ subject: 'Remittance advice – INV-IRC1010-3' }), expect.any(Array))
    expect(res.text).toBe('Saved "Remittance advice – INV-IRC1010-3" with 1 attachment to IRC1010.')
  })

  it('puts it on the job the user named when matching picks another (or none)', async () => {
    insertLinked.mockResolvedValueOnce({ job_id: null, source: 'unlinked', match_candidates: null })
    db.communications.push({ id: 'new', tenant_id: 't1' })
    const res = await saveEmail.run({ message_id: 'gm123456', job_number: 'IRC1001' }, ctx)
    expect(res.text).toMatch(/to IRC1001\.$/)
  })

  it('doesn’t save it twice, and refuses our own emails', async () => {
    db.communications.push({ id: 'old', tenant_id: 't1', gmail_message_id: '<rem@castle>', job_id: 'j10' })
    expect((await saveEmail.run({ message_id: 'gm123456' }, ctx)).text).toBe('That email is already on IRC1010.')
    expect(insertLinked).not.toHaveBeenCalled()
    extract.mockResolvedValueOnce(castleMsg({ fromEmail: 'kyle@insurancerepairco.com.au' }))
    expect((await saveEmail.run({ message_id: 'gm123456' }, ctx)).isError).toBe(true)
  })
})

describe('link_email_to_job', () => {
  it('puts the email and its conversation on the job', async () => {
    const res = await linkEmailToJob.run({ email_id: E1, job_number: 'IRC1010' }, ctx)
    expect(updates[0]).toEqual({ job_id: 'j10', match_candidates: null })
    expect(linkThread).toHaveBeenCalledWith(client, 't1', 'th1', 'j10')
    expect(res.text).toBe('Put "Instructions" on IRC1010, with 2 other emails from the same conversation.')
  })
})
