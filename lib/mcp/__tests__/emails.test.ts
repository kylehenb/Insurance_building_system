import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Email tools: listing and reading a job's emails, and replying with the
// Reply box's own function — which still threads the reply, sends from the
// office and records it, and still answers the app exactly as before.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const inserts: Row[] = []
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  let limit = Infinity
  const apply = () => (db[table] ?? []).filter(r => preds.every(p => p(r))).slice(0, limit)
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    is: (c: string, v: unknown) => { preds.push(r => (r[c] ?? null) === v); return b },
    gte: (c: string, v: string) => { preds.push(r => String(r[c]) >= v); return b },
    ilike: (c: string, p: string) => { preds.push(r => String(r[c]).toLowerCase() === p.toLowerCase()); return b },
    order: () => b,
    limit: (n: number) => { limit = n; return b },
    upsert: async () => ({ error: null }),
    insert: async (row: Row) => { inserts.push(row); return { error: null } },
    single: async () => { const r = apply()[0]; return r ? { data: r, error: null } : { data: null, error: { code: 'PGRST116' } } },
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: apply(), error: null }).then(res),
  }
  return b
}
const client = { from: query }

const gmailSend = vi.fn(async (_req: unknown) => ({ data: { id: 'sent1' } }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => client, createClient: async () => client }))
vi.mock('@/lib/gmail/client', () => ({ getGmailClient: () => ({ users: { messages: { send: gmailSend } } }) }))
// Permissions are tested in lib/permissions; here the user is allowed
vi.mock('@/lib/permissions/http', () => ({ permissionDenied: async () => null }))
vi.mock('@/lib/supabase/get-user', () => ({ getUser: async () => ({ tenant_id: 't1' }) }))

const { listJobEmails, getEmail, replyToEmailTool } = await import('../tools/emails')
const { POST: replyRoute } = await import('@/app/api/communications/reply/route')

const ctx = { supabase: client as never, tenantId: 't1', userId: 'u1' }
const IN = '44444444-4444-4444-4444-444444444444'
const OUT = '55555555-5555-5555-5555-555555555555'
const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString()
const sentRaw = () => Buffer.from((gmailSend.mock.calls[0][0] as { requestBody: { raw: string } }).requestBody.raw, 'base64url').toString()

beforeEach(() => {
  vi.clearAllMocks()
  inserts.length = 0
  db.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001', property_address: '123 Test Street', insured_name: 'Smith' }]
  db.tenants = [{ id: 't1', contact_email: 'office@insurancerepairco.com.au' }]
  db.communications = [
    { id: IN, tenant_id: 't1', type: 'email', direction: 'inbound', job_id: 'j1', thread_id: 'th1', gmail_message_id: 'abc@mail.example',
      created_at: minutesAgo(60), from_email: 'plumber@example.com', to_email: 'office@insurancerepairco.com.au', subject: 'Access on Tuesday?',
      body_text: 'Hi, can I get in on Tuesday at 8?\n\nOn Mon, Kyle wrote:\n> earlier message', content: null, attachments: [{ filename: 'photo.jpg' }] },
    { id: OUT, tenant_id: 't1', type: 'email', direction: 'outbound', job_id: 'j1', thread_id: 'th2', created_at: minutesAgo(120),
      from_email: 'office@insurancerepairco.com.au', to_email: 'claims@insurer.example', subject: 'Report', body_text: 'Please find attached', content: null, attachments: [] },
    { id: 'u1', tenant_id: 't1', type: 'email', direction: 'inbound', job_id: null, thread_id: 'th3', created_at: minutesAgo(30),
      from_email: 'new@example.com', to_email: 'office@x', subject: 'Unlinked', body_text: 'Hello', content: null, attachments: [] },
  ]
})

describe('list_job_emails / get_email', () => {
  it('lists a job’s emails with just the new text', async () => {
    const res = await listJobEmails.run({ job_number: 'IRC1001' }, ctx)
    expect(res.text).toContain('from plumber@example.com: "Access on Tuesday?" — Hi, can I get in on Tuesday at 8? [1 attachment]')
    expect(res.text).toContain('we sent to claims@insurer.example: "Report"')
    expect(res.text).not.toContain('earlier message')
  })

  it('lists incoming emails not on a job when no job is given', async () => {
    const res = await listJobEmails.run({}, ctx)
    expect(res.text).toMatch(/^Incoming emails not on a job/)
    expect(res.text).toContain('"Unlinked"')
    expect(res.text).not.toContain('Access on Tuesday')
  })

  it('reads one email in full', async () => {
    const res = await getEmail.run({ email_id: IN }, ctx)
    expect(res.text).toContain('From: plumber@example.com.')
    expect(res.text).toContain('Attachments: photo.jpg.')
    expect(res.text).toContain('> earlier message')
  })
})

describe('reply_to_email', () => {
  it('replies in the thread, from the office, and records it', async () => {
    const res = await replyToEmailTool.run({ email_id: IN, body: 'Tuesday at 8 is fine. Thanks, Kyle' }, ctx)
    expect(res.text).toBe('Replied to plumber@example.com: "Re: Access on Tuesday?".')
    expect(gmailSend).toHaveBeenCalledWith(expect.objectContaining({ requestBody: expect.objectContaining({ threadId: 'th1' }) }))
    expect(sentRaw()).toMatch(/In-Reply-To: <abc@mail\.example>/)
    expect(inserts[0]).toMatchObject({ direction: 'outbound', job_id: 'j1', thread_id: 'th1', to_email: 'plumber@example.com', source: 'manual_reply' })
  })

  it('won’t reply to our own email, or repeat the same reply minutes later', async () => {
    expect((await replyToEmailTool.run({ email_id: OUT, body: 'x' }, ctx)).isError).toBe(true)

    db.communications.push({ id: 'r1', tenant_id: 't1', type: 'email', direction: 'outbound', job_id: 'j1', thread_id: 'th1', created_at: minutesAgo(2), content: 'Tuesday at 8 is fine.' })
    const res = await replyToEmailTool.run({ email_id: IN, body: 'Tuesday at 8 is fine.' }, ctx)
    expect(res).toMatchObject({ isError: true, text: expect.stringMatching(/^Not sent: that same reply/) })
    expect(gmailSend).not.toHaveBeenCalled()

    await replyToEmailTool.run({ email_id: IN, body: 'Tuesday at 8 is fine.', send_anyway: true }, ctx)
    expect(gmailSend).toHaveBeenCalledTimes(1)
  })

  it('never reaches another tenant’s email', async () => {
    db.communications[0].tenant_id = 'other'
    expect((await replyToEmailTool.run({ email_id: IN, body: 'Hi' }, ctx)).isError).toBe(true)
    expect(gmailSend).not.toHaveBeenCalled()
  })
})

describe('Reply box route', () => {
  const post = (body: unknown) => replyRoute(new NextRequest('https://app.test/api/communications/reply', { method: 'POST', body: JSON.stringify(body) }))

  it('answers as before', async () => {
    expect(await (await post({ commId: IN, body: ' Sure ' })).json()).toEqual({ ok: true })
    expect(inserts[0]).toMatchObject({ content: 'Sure' })
    expect((await post({ commId: IN })).status).toBe(400)
    const missing = await post({ commId: '00000000-0000-0000-0000-000000000000', body: 'x' })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'Communication not found' })

    vi.spyOn(console, 'error').mockImplementation(() => {})
    gmailSend.mockRejectedValueOnce(new Error('gmail down'))
    const failed = await post({ commId: IN, body: 'x' })
    expect(failed.status).toBe(502)
    expect(await failed.json()).toEqual({ error: 'Failed to send email' })
  })
})
