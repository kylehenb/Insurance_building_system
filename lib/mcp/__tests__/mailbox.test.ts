import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mailbox tools: they call the Mail page's own functions (lib/mail) with the
// right arguments, refuse what the page would refuse, and guard repeats.

const mailbox = { id: 'mb1', tenant_id: 't1', email_address: 'office@insurancerepairco.com.au' }
const thread = {
  id: 'abc1', subject: 'Roof leak', snippet: 'Can you quote?', participants: [{ name: 'Jane', email: 'jane@insurer.com', me: false }],
  recipients: [], last_message_at: '2026-10-23T06:00:00.000Z', message_count: 2, label_ids: ['INBOX', 'UNREAD'], unread: true,
  has_attachments: true, job: { id: 'j1', job_number: 'IRC1001', insured_name: null },
}
const detail = {
  id: 'abc1', subject: 'Roof leak', label_ids: ['INBOX'], job: null, drafts: [],
  messages: [
    { id: 'aa1', threadId: 'abc1', labelIds: ['INBOX'], from: { name: 'Jane', email: 'jane@insurer.com' }, to: [], cc: [], replyTo: [], subject: 'Roof leak', date: '2026-10-23T06:00:00.000Z', snippet: '', html: '<p>Can you <b>quote</b>?</p>', text: '', attachments: [] },
    { id: 'aa2', threadId: 'abc1', labelIds: ['DRAFT'], from: null, to: [], cc: [], replyTo: [], subject: '', date: null, snippet: '', html: '', text: 'half written', attachments: [] },
  ],
}

const calls: Record<string, unknown[][]> = {}
const spy = <T>(name: string, impl: (...a: unknown[]) => T) => vi.fn(async (...a: unknown[]) => { (calls[name] ??= []).push(a); return impl(...a) })

vi.mock('@/lib/mail/sync', () => ({ getMailbox: async () => mailbox }))
vi.mock('@/lib/mail/list', () => ({
  listFolder: spy('listFolder', () => ({ threads: [thread], cursor: null })),
  searchFolder: spy('searchFolder', () => ({ threads: [thread], cursor: null })),
  getThreadDetail: spy('getThreadDetail', () => detail),
}))
vi.mock('@/lib/mail/actions', () => ({ MAX_THREADS_PER_ACTION: 100, applyThreadAction: spy('applyThreadAction', (_m, ids) => ({ done: ids, failed: [] })) }))
vi.mock('@/lib/mail/compose', async () => {
  const { emptyCompose } = await import('@/lib/mail/compose-rules')
  class ComposeError extends Error {}
  return {
    ComposeError,
    startCompose: spy('startCompose', (_m, mode) => ({ ...emptyCompose(), mode, quoteHtml: '', ...(mode === 'new' ? {} : { to: 'Jane <jane@insurer.com>', subject: 'Re: Roof leak', threadId: 'abc1', quoteMessageId: 'aa1' }) })),
    saveDraft: spy('saveDraft', () => ({ draftId: 'd1', threadId: 'abc1', messageId: 'dm1' })),
    sendDraft: spy('sendDraft', () => ({ messageId: 's1', threadId: 'abc1' })),
  }
})
vi.mock('@/lib/mail/scheduled', () => ({ scheduleDraft: spy('scheduleDraft', (_m, _u, _d, at) => ({ send_at: at })) }))

let sentRows: { content: string; to_email: string }[] = []
const supabase = {
  from: () => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, gte: () => b,
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: sentRows, error: null }).then(res),
    }
    return b
  },
}
const ctx = { supabase: supabase as never, tenantId: 't1', userId: 'u1' }

const { listMailbox, readConversation, organiseEmails, sendEmailTool } = await import('../tools/mailbox')

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k]
  sentRows = []
})

describe('list_mailbox', () => {
  it('lists the inbox Primary tab from the mirror', async () => {
    const out = await listMailbox.run({}, ctx)
    expect(calls.listFolder[0].slice(1)).toEqual(['inbox', 'primary', null])
    expect(out.text).toContain('(unread)')
    expect(out.text).toContain('from Jane: "Roof leak" — Can you quote? [2 messages] [attachments] [IRC1001]')
  })

  it('searches Gmail for a search or unread only', async () => {
    await listMailbox.run({ folder: 'sent', search: 'from:castle', unread_only: true }, ctx)
    expect(calls.searchFolder[0].slice(1, 4)).toEqual(['sent', null, 'from:castle is:unread'])
  })
})

describe('read_conversation', () => {
  it('reads each message as text, marking drafts', async () => {
    const out = await readConversation.run({ conversation_id: 'abc1' }, ctx)
    expect(out.text).toContain('Can you quote?')
    expect(out.text).toContain('[DRAFT]')
    expect((out.data as { messages: { message_id: string }[] }).messages.map(m => m.message_id)).toEqual(['aa1', 'aa2'])
  })

  it('refuses a bad id', async () => {
    expect((await readConversation.run({ conversation_id: 'x; drop' }, ctx)).isError).toBe(true)
  })
})

describe('organise_emails', () => {
  it('archives through the page\'s action', async () => {
    const out = await organiseEmails.run({ conversation_ids: ['abc1', 'abc1', 'bad id'], action: 'archive' }, ctx)
    expect(calls.applyThreadAction[0].slice(1)).toEqual([['abc1'], 'archive'])
    expect(out.text).toBe('1 conversation archived.')
  })
})

describe('send_email', () => {
  it('replies to a conversation\'s latest sent message, as plain text made rich', async () => {
    const out = await sendEmailTool.run({ mode: 'reply', conversation_id: 'abc1', body: 'Thanks Jane\nBooked for Thursday' }, ctx)
    expect(calls.startCompose[0].slice(1)).toEqual(['reply', 'aa1'])
    const state = calls.saveDraft[0][3] as { body: string; to: string; subject: string }
    expect(state.body).toBe('<p>Thanks Jane</p><p>Booked for Thursday</p>')
    expect(state.to).toBe('Jane <jane@insurer.com>')
    expect(calls.sendDraft[0][1]).toBe('d1')
    expect(out.text).toBe('Sent "Re: Roof leak" to jane@insurer.com.')
  })

  it('needs a recipient and subject for a new email', async () => {
    expect((await sendEmailTool.run({ body: 'Hi' }, ctx)).text).toMatch(/no recipient/)
    expect((await sendEmailTool.run({ to: 'bob@trade.com', body: 'Hi' }, ctx)).text).toMatch(/subject/)
    expect(calls.saveDraft).toBeUndefined()
  })

  it('schedules in Perth time, or only saves a draft', async () => {
    const out = await sendEmailTool.run({ to: 'bob@trade.com', subject: 'Plans', body: 'Hi Bob', send_at: '2099-10-26T08:00' }, ctx)
    expect(calls.scheduleDraft[0][3]).toBe('2099-10-26T00:00:00.000Z')
    expect(calls.sendDraft).toBeUndefined()
    expect(out.text).toMatch(/^Scheduled "Plans" to bob@trade.com for Mon 26 Oct, 8:00 am/)

    const draft = await sendEmailTool.run({ body: 'notes so far', draft_only: true }, ctx)
    expect(draft.text).toMatch(/^Saved to Drafts/)
    expect(calls.sendDraft).toBeUndefined()
  })

  it('refuses the same email to the same person twice in 10 minutes unless send_anyway', async () => {
    sentRows = [{ to_email: 'Bob <bob@trade.com>', content: 'Hi Bob,  the plans are attached.\n\nKind regards' }]
    const args = { to: 'bob@trade.com', subject: 'Plans', body: 'Hi Bob, the plans are attached.' }
    const refused = await sendEmailTool.run(args, ctx)
    expect(refused.isError).toBe(true)
    expect(calls.saveDraft).toBeUndefined()
    await sendEmailTool.run({ ...args, send_anyway: true }, ctx)
    expect(calls.sendDraft).toHaveLength(1)
  })
})
