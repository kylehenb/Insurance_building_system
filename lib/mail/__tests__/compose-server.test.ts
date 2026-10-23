import { describe, it, expect, vi, beforeEach } from 'vitest'

// buildMime / saveDraft / sendDraft against a fake Gmail and database

const b64 = (s: string) => Buffer.from(s).toString('base64url')
const gmailCalls: { method: string; args: Record<string, unknown> }[] = []

const original = {
  id: 'orig1',
  threadId: 'thr1',
  internalDate: String(Date.parse('2026-10-23T06:39:00Z')),
  labelIds: ['INBOX'],
  payload: {
    mimeType: 'multipart/mixed',
    headers: [
      { name: 'From', value: 'Jane Smith <jane@insurer.com>' },
      { name: 'To', value: 'office@insurancerepairco.com.au' },
      { name: 'Subject', value: 'Roof leak' },
      { name: 'Message-ID', value: '<abc@insurer.com>' },
      { name: 'References', value: '<first@insurer.com>' },
    ],
    parts: [
      { mimeType: 'text/html', body: { data: b64('<p>Please quote.</p>') } },
      { mimeType: 'application/pdf', filename: 'scope.pdf', headers: [{ name: 'Content-Disposition', value: 'attachment' }], body: { attachmentId: 'ATT1', size: 3 } },
    ],
  },
}

const gmail = {
  users: {
    messages: {
      get: vi.fn(async () => ({ data: original })),
      attachments: { get: vi.fn(async () => ({ data: { data: b64('PDF') } })) },
    },
    drafts: {
      create: vi.fn(async (args: Record<string, unknown>) => { gmailCalls.push({ method: 'drafts.create', args }); return { data: { id: 'd1', message: { id: 'dm1', threadId: 'thr1' } } } }),
      update: vi.fn(async (args: Record<string, unknown>) => { gmailCalls.push({ method: 'drafts.update', args }); return { data: { id: 'd1', message: { id: 'dm2', threadId: 'thr1' } } } }),
      send: vi.fn(async (args: Record<string, unknown>) => { gmailCalls.push({ method: 'drafts.send', args }); return { data: { id: 'sent1', threadId: 'thr1' } } }),
    },
    threads: { get: vi.fn(async () => ({ data: { id: 'thr1', messages: [original] } })) },
  },
}
vi.mock('@/lib/gmail/client', () => ({ getGmailClient: () => gmail }))

const rows: Record<string, unknown>[] = []
const removed: string[][] = []
function table(name: string) {
  const q: Record<string, unknown> = {}
  const chain = new Proxy(q, {
    get(_t, prop: string) {
      if (prop === 'single' || prop === 'maybeSingle') {
        return async () => name === 'tenants'
          ? { data: { name: 'IRC', trading_name: 'Insurance Repair Co', email_signature: '<p>Kind regards,<br>The IRC team</p>', email_signature_image_path: null, email_signature_image_width: null, email_signature_image_height: null } }
          : { data: rows.find(r => r.gmail_draft_id === 'd1') ?? null }
      }
      if (prop === 'upsert') return async (row: Record<string, unknown>) => { if (name === 'mail_drafts') { rows.splice(0, rows.length, row) } return { error: null } }
      if (prop === 'then') return undefined
      return () => chain
    },
  })
  return chain
}
const db = {
  from: table,
  storage: { from: () => ({ download: async () => ({ data: new Blob(['hello']) }), remove: async (p: string[]) => { removed.push(p); return {} }, upload: async () => ({}) }) },
}
vi.mock('../sync', () => ({ mailDb: () => db, fetchThreads: vi.fn(async () => 1) }))

const { buildMime, saveDraft, sendDraft } = await import('../compose')
const { emptyCompose } = await import('../compose-rules')

const mailbox = { id: 'mb1', tenant_id: 't1', email_address: 'office@insurancerepairco.com.au', history_id: null, backfilled_at: null, synced_at: null, sync_error: null }
const decode = (raw: string) => Buffer.from(raw, 'base64url').toString()
const htmlPart = (mime: string) => {
  const m = mime.match(/Content-Type: text\/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/)
  return m ? Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString() : ''
}

beforeEach(() => { gmailCalls.length = 0 })

describe('buildMime', () => {
  it('builds a reply: threading headers, signature, quote', async () => {
    const mime = decode(await buildMime(mailbox, 't1', {
      ...emptyCompose(), mode: 'reply', threadId: 'thr1', quoteMessageId: 'orig1',
      to: 'Jane Smith <jane@insurer.com>', subject: 'Re: Roof leak', body: '<p>Thanks Jane, booked for Thursday.</p>',
    }, db as never))
    expect(mime).toContain('From: "Insurance Repair Co" <office@insurancerepairco.com.au>')
    expect(mime).toContain('To: "Jane Smith" <jane@insurer.com>')
    expect(mime).toContain('In-Reply-To: <abc@insurer.com>')
    expect(mime).toContain('References: <first@insurer.com> <abc@insurer.com>')
    const html = htmlPart(mime)
    expect(html).toContain('Thanks Jane, booked for Thursday.')
    expect(html).toContain('The IRC team')
    expect(html).toContain('class="gmail_quote"')
    expect(html.indexOf('The IRC team')).toBeLessThan(html.indexOf('gmail_quote'))
  })

  it('leaves the signature out when asked, and attaches files', async () => {
    const mime = decode(await buildMime(mailbox, 't1', {
      ...emptyCompose(), to: 'bob@trade.com', subject: 'Plans', body: '<p>Attached.</p>', includeSignature: false,
      attachments: [{ kind: 'upload', path: 't1/x/plans.txt', filename: 'plans.txt', mimeType: 'text/plain', size: 5 }],
    }, db as never))
    expect(htmlPart(mime)).not.toContain('The IRC team')
    expect(mime).toContain('Content-Disposition: attachment; filename="plans.txt"')
    expect(mime).toContain(Buffer.from('hello').toString('base64'))
  })

  it('refuses another company\'s uploads and bad addresses', async () => {
    await expect(buildMime(mailbox, 't1', { ...emptyCompose(), attachments: [{ kind: 'upload', path: 't2/x/a.txt', filename: 'a.txt', mimeType: 'text/plain', size: 1 }] }, db as never)).rejects.toThrow('Attachment not found')
    await expect(buildMime(mailbox, 't1', { ...emptyCompose(), to: 'not an address' }, db as never)).rejects.toThrow("To has an address that isn't valid")
  })
})

describe('drafts', () => {
  it('creates, then updates the same Gmail draft in its thread, and sends it', async () => {
    const state = { ...emptyCompose(), mode: 'reply' as const, threadId: 'thr1', quoteMessageId: 'orig1', to: 'jane@insurer.com', subject: 'Re: Roof leak', body: '<p>Hi</p>' }
    const first = await saveDraft(mailbox, 't1', 'u1', state, db as never)
    expect(first).toEqual({ draftId: 'd1', threadId: 'thr1', messageId: 'dm1' })
    expect(gmailCalls[0].method).toBe('drafts.create')
    expect((gmailCalls[0].args.requestBody as { message: { threadId: string } }).message.threadId).toBe('thr1')
    expect(rows[0]).toMatchObject({ gmail_draft_id: 'd1', body: '<p>Hi</p>', quote_message_id: 'orig1', mode: 'reply' })

    await saveDraft(mailbox, 't1', 'u1', { ...state, draftId: 'd1', body: '<p>Hi Jane</p>' }, db as never)
    expect(gmailCalls[1]).toMatchObject({ method: 'drafts.update', args: { id: 'd1' } })

    rows[0] = { ...rows[0], attachments: [{ kind: 'upload', path: 't1/x/a.txt', filename: 'a.txt', mimeType: 'text/plain', size: 1 }] }
    expect(await sendDraft(mailbox, 'd1', db as never)).toEqual({ messageId: 'sent1', threadId: 'thr1' })
    expect(gmailCalls[2]).toMatchObject({ method: 'drafts.send', args: { requestBody: { id: 'd1' } } })
    expect(removed.at(-1)).toEqual(['t1/x/a.txt'])
  })
})
