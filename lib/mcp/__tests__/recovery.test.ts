import { describe, it, expect, vi, beforeEach } from 'vitest'

// Recovering emails the auto lodger dropped: found again in Gmail from the
// audit log's sender, subject and time; saved once (matched by Message-ID);
// processed in batches with a cursor.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  let limit = Infinity
  let count = false
  const all = () => (db[table] ?? []).filter(r => preds.every(p => p(r)))
  const b: Record<string, unknown> = {
    select: (_c: string, o?: { count?: string }) => { count = !!o?.count; return b },
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    gt: (c: string, v: string) => { preds.push(r => String(r[c]) > v); return b },
    in: (c: string, vs: unknown[]) => { preds.push(r => vs.includes(r[c])); return b },
    order: (c: string) => { db[table] = [...(db[table] ?? [])].sort((x, y) => String(x[c]).localeCompare(String(y[c]))); return b },
    limit: (n: number) => { limit = n; return b },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: all().slice(0, limit), error: null, ...(count ? { count: all().length } : {}) }).then(res),
  }
  return b
}
const client = { from: query }

interface Mail { id: string; subject: string; rfc: string; at: string }
let inbox: Mail[] = []
const gmail = {
  list: vi.fn(async (_req: { q: string }) => ({ data: { messages: inbox.map(m => ({ id: m.id })) } })),
  get: vi.fn(async (req: { id: string }) => {
    const m = inbox.find(x => x.id === req.id)!
    return { data: { internalDate: String(Date.parse(m.at)), payload: { headers: [{ name: 'Subject', value: m.subject }, { name: 'Message-ID', value: m.rfc }] } } }
  }),
}
const insertLinked = vi.fn()
vi.mock('@/lib/gmail/client', () => ({ getGmailClient: () => ({ users: { messages: { list: gmail.list, get: gmail.get } } }) }))
vi.mock('@/lib/gmail/messages', () => ({
  getFullMessage: async (id: string) => ({ id }),
  extractMessageParts: async (m: { id: string }) => {
    const mail = inbox.find(x => x.id === m.id)!
    return { messageId: mail.id, gmailMessageId: mail.rfc, subject: mail.subject, attachments: [] }
  },
}))
vi.mock('@/lib/communications/inbound-email', () => ({
  uploadAttachments: async () => [],
  insertLinkedCommunication: (...a: unknown[]) => insertLinked(...a),
}))

const { parseAuditSummary } = await import('@/lib/communications/recover-dropped')
const { recoverDroppedEmails } = await import('../tools/recovery')

const ctx = { supabase: client as never, tenantId: 't1', userId: 'u1' }
const audit = (id: string, at: string, subject: string, from = 'castleinsurance.mailer@primeeco.tech') =>
  ({ id, tenant_id: 't1', prompt_key: 'email_order_parser', outcome: 'rejected', created_at: at, input_summary: `Email: "${subject}" from ${from}` })

beforeEach(() => {
  vi.clearAllMocks()
  db.jobs = [{ id: 'j10', tenant_id: 't1', job_number: 'IRC1010' }]
  db.communications = []
  db.ai_audit = [
    audit('a1', '2026-10-19T02:56:00Z', 'Remittance advice – your invoice #irc1068 - Our claim CHCCLM010001752'),
    audit('a2', '2026-10-20T00:28:00Z', 'Re: Authorised Job CHCCLM010001141 Tamar Cook'),
    audit('a3', '2026-10-20T00:29:00Z', 'Re: Authorised Job CHCCLM010001141 Tamar Cook'),
    { ...audit('a4', '2026-10-20T01:00:00Z', 'x'), outcome: 'pending' },
  ]
  inbox = [
    { id: 'm1', subject: 'Remittance advice – your invoice #irc1068  - Our claim CHCCLM010001752', rfc: '<r1@castle>', at: '2026-10-19T02:55:00Z' },
    { id: 'm2', subject: 'Re: Authorised Job CHCCLM010001141 Tamar Cook', rfc: '<t1@castle>', at: '2026-10-20T00:27:00Z' },
    { id: 'm3', subject: 'Re: Authorised Job CHCCLM010001141 Tamar Cook', rfc: '<t2@castle>', at: '2026-10-20T00:28:30Z' },
  ]
  insertLinked.mockImplementation(async (_db: unknown, _t: unknown, id: string, msg: { gmailMessageId: string }) => {
    db.communications.push({ id, tenant_id: 't1', gmail_message_id: msg.gmailMessageId, job_id: 'j10' })
    return { job_id: 'j10', source: 'auto_linked', match_candidates: null }
  })
})

describe('recover_dropped_emails', () => {
  it('reads the audit summary', () => {
    expect(parseAuditSummary('Email: "Re: "quoted" thing" from a@b.com')).toEqual({ subject: 'Re: "quoted" thing', from: 'a@b.com' })
    expect(parseAuditSummary('something else')).toBeNull()
  })

  it('dry run finds the emails and saves nothing', async () => {
    const res = await recoverDroppedEmails.run({ dry_run: true }, ctx)
    expect(res.text).toMatch(/^Dry run: 3 would be saved, 0 already saved, 0 not found in Gmail, 0 errors\./)
    expect(gmail.list).toHaveBeenCalledWith(expect.objectContaining({ q: expect.stringMatching(/^from:castleinsurance\.mailer@primeeco\.tech after:\d+ before:\d+$/) }))
    expect(insertLinked).not.toHaveBeenCalled()
  })

  it('saves each dropped email once, telling same-subject replies apart', async () => {
    const res = await recoverDroppedEmails.run({}, ctx)
    expect(insertLinked).toHaveBeenCalledTimes(3)
    expect(db.communications.map(c => c.gmail_message_id).sort()).toEqual(['<r1@castle>', '<t1@castle>', '<t2@castle>'])
    expect(res.text).toContain('saved → IRC1010')
    expect(res.data).toMatchObject({ done: true, next_cursor: null })

    // Running again finds them all saved
    const again = await recoverDroppedEmails.run({}, ctx)
    expect(again.text).toMatch(/^0 saved, 3 already saved/)
    expect(insertLinked).toHaveBeenCalledTimes(3)
  })

  it('works in batches with a cursor', async () => {
    const first = await recoverDroppedEmails.run({ batch_size: 2 }, ctx)
    expect(first.data).toMatchObject({ done: false, remaining: 1, next_cursor: '2026-10-20T00:28:00Z' })
    expect(first.text).toMatch(/1 more to go/)
    const second = await recoverDroppedEmails.run({ batch_size: 2, cursor: '2026-10-20T00:28:00Z' }, ctx)
    expect(second.data).toMatchObject({ done: true })
    expect(insertLinked).toHaveBeenCalledTimes(3)
  })

  it('reports emails no longer in Gmail, and saved emails with no job', async () => {
    inbox = inbox.filter(m => m.id !== 'm1')
    insertLinked.mockImplementation(async (_d: unknown, _t: unknown, id: string, msg: { gmailMessageId: string }) => {
      db.communications.push({ id, tenant_id: 't1', gmail_message_id: msg.gmailMessageId, job_id: null })
      return { job_id: null, source: 'unlinked', match_candidates: null }
    })
    const res = await recoverDroppedEmails.run({}, ctx)
    expect(res.text).toContain('not found (not in Gmail (deleted, or the subject changed))')
    expect(res.text).toContain('2 saved emails couldn\'t be matched to a job')
  })
})
