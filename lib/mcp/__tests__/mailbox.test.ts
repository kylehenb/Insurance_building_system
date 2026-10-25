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
vi.mock('@/lib/mail/file-thread', () => {
  class FileThreadError extends Error {}
  return {
    FileThreadError,
    fileThread: spy('fileThread', (_m, id) => { if (id === 'dead1') throw new FileThreadError('That conversation is no longer in Gmail'); return {} }),
  }
})
const PHOTO = '11111111-1111-1111-1111-111111111111'
const PHOTO2 = '22222222-2222-2222-2222-222222222222'
const FILE = '33333333-3333-3333-3333-333333333333'
vi.mock('@/lib/mail/job-files', () => ({
  listJobAttachables: spy('listJobAttachables', () => ({
    photos: [
      { id: PHOTO, name: 'Kitchen ceiling.jpg', label: 'Kitchen ceiling', size: 100, thumbUrl: null },
      { id: PHOTO2, name: 'Photo 2.jpg', label: null, size: 100, thumbUrl: null },
    ],
    files: [{ id: FILE, name: 'Scope.pdf', description: 'From insurer', mimeType: 'application/pdf', size: 50, createdAt: '2026-10-01' }],
  })),
  readJobFile: spy('readJobFile', (_t, _j, source, id) => ({ filename: source === 'file' ? 'Scope.pdf' : `${id}.jpg`, mimeType: source === 'file' ? 'application/pdf' : 'image/jpeg', content: Buffer.from('x') })),
  storeDraftUpload: spy('storeDraftUpload', (_t, f) => {
    const file = f as { filename: string; mimeType: string; content: Buffer }
    return { kind: 'upload', path: `t1/x/${file.filename}`, filename: file.filename, mimeType: file.mimeType, size: file.content.length }
  }),
}))
vi.mock('@/lib/mcp/tools/excess', () => ({
  isToolResult: (v: unknown) => !!v && typeof v === 'object' && 'text' in v,
  jobFromArgs: async (args: { job_number?: string }) =>
    args.job_number === 'IRC1001' ? { id: 'j1', job_number: 'IRC1001' } : { text: `No job ${args.job_number} found.`, isError: true },
}))

let sentRows: { content: string; to_email: string }[] = []
let starRows: { id: string; source_ref: string; status: string; title: string; category: string }[] = []
const supabase = {
  from: (name: string) => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, gte: () => b, in: () => b,
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: name === 'action_queue' ? starRows : sentRows, error: null }).then(res),
    }
    return b
  },
}
const ctx = { supabase: supabase as never, tenantId: 't1', userId: 'u1' }

const { listMailbox, readConversation, organiseEmails, sendEmailTool, fileConversation, listJobFiles } = await import('../tools/mailbox')

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k]
  sentRows = []
  starRows = []
})

describe('list_mailbox', () => {
  it('lists the inbox Primary tab from the mirror', async () => {
    const out = await listMailbox.run({}, ctx)
    expect(calls.listFolder[0].slice(1)).toEqual(['inbox', 'primary', null, undefined, null])
    expect(out.text).toContain('(unread)')
    expect(out.text).toContain('from Jane: "Roof leak" — Can you quote? [2 messages] [attachments] [IRC1001]')
    expect(out.text).not.toContain('starred')
  })

  it('shows which are starred, and under which star', async () => {
    starRows = [{ id: 'k1', source_ref: 'abc1', status: 'pending', title: 'Pay Jane', category: 'invoice' }]
    const out = await listMailbox.run({}, ctx)
    expect(out.text).toContain('[IRC1001] [starred: Invoices to pay]')
    expect((out.data!.conversations as { star: string }[])[0].star).toBe('invoice')
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
    expect(calls.startCompose[0].slice(1)).toEqual(['reply', 'aa1', null])
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

describe('send_email with a job\'s photos and files', () => {
  it('files it on the job and attaches the chosen photos and files', async () => {
    const out = await sendEmailTool.run({ to: 'bob@trade.com', subject: 'Photos', body: 'Hi Bob', job_number: 'IRC1001', attach_photos: [PHOTO], attach_files: [FILE] }, ctx)
    expect(calls.startCompose[0].slice(1)).toEqual(['new', null, 'j1'])
    expect(calls.readJobFile.map(c => c.slice(0, 4))).toEqual([['t1', 'j1', 'photo', PHOTO], ['t1', 'j1', 'file', FILE]])
    const state = calls.saveDraft[0][3] as { attachments: { filename: string }[] }
    expect(state.attachments.map(a => a.filename)).toEqual([`${PHOTO}.jpg`, 'Scope.pdf'])
    expect(out.text).toBe('Sent "Photos" to bob@trade.com with 2 attachments.')
  })

  it('attaches every photo for ["all"]', async () => {
    await sendEmailTool.run({ to: 'bob@trade.com', subject: 'Photos', body: 'Hi', job_number: 'IRC1001', attach_photos: ['all'] }, ctx)
    expect(calls.readJobFile.map(c => c[3])).toEqual([PHOTO, PHOTO2])
  })

  it('needs the job, and photos that are on it', async () => {
    expect((await sendEmailTool.run({ to: 'bob@trade.com', subject: 'x', body: 'Hi', attach_photos: [PHOTO] }, ctx)).text).toMatch(/Which job/)
    expect((await sendEmailTool.run({ to: 'bob@trade.com', subject: 'x', body: 'Hi', job_number: 'IRC9', attach_photos: [PHOTO] }, ctx)).text).toMatch(/No job IRC9/)
    expect((await sendEmailTool.run({ to: 'bob@trade.com', subject: 'x', body: 'Hi', job_number: 'IRC1001', attach_photos: ['bathroom'] }, ctx)).text).toMatch(/list_job_files/)
    expect(calls.readJobFile).toBeUndefined()
    expect(calls.saveDraft).toBeUndefined()
  })
})

describe('list_job_files', () => {
  it('lists numbered photos and files with their ids', async () => {
    const out = await listJobFiles.run({ job_number: 'IRC1001' }, ctx)
    expect(out.text).toBe('2 photos on IRC1001: 1. Kitchen ceiling; 2. Photo 2.jpg. 1 file: Scope.pdf — From insurer.')
    const data = out.data as { photos: { photo_id: string }[]; files: { file_id: string }[] }
    expect(data.photos.map(p => p.photo_id)).toEqual([PHOTO, PHOTO2])
    expect(data.files[0].file_id).toBe(FILE)
  })
})

describe('phase 5 by voice', () => {
  it('lists what needs filing', async () => {
    await listMailbox.run({ filing: 'to_file' }, ctx)
    expect(calls.listFolder[0].slice(1)).toEqual(['inbox', 'primary', null, undefined, 'to_file'])
  })

  it('has no snooze any more', async () => {
    expect((await organiseEmails.run({ conversation_ids: ['abc1'], action: 'snooze' }, ctx)).isError).toBe(true)
  })
})

describe('file_conversation', () => {
  it('files on a job, as admin, or back to To file', async () => {
    expect((await fileConversation.run({ conversation_id: 'abc1', job_number: 'IRC1001' }, ctx)).text).toBe('Filed on IRC1001.')
    expect(calls.fileThread[0].slice(1)).toEqual(['abc1', { jobId: 'j1' }])
    expect((await fileConversation.run({ conversation_id: 'abc1', filing: 'admin' }, ctx)).text).toBe('Filed as admin.')
    expect(calls.fileThread[1].slice(1)).toEqual(['abc1', { filing: 'admin' }])
    expect((await fileConversation.run({ conversation_id: 'abc1', filing: 'to_file' }, ctx)).text).toBe('Moved back to To file.')
  })

  it('refuses a missing job, no choice, a bad id, or what Gmail no longer has', async () => {
    expect(await fileConversation.run({ conversation_id: 'abc1', job_number: 'IRC9' }, ctx)).toMatchObject({ isError: true, text: 'No job IRC9 found.' })
    expect((await fileConversation.run({ conversation_id: 'abc1' }, ctx)).isError).toBe(true)
    expect((await fileConversation.run({ conversation_id: 'not an id', filing: 'admin' }, ctx)).isError).toBe(true)
    expect(await fileConversation.run({ conversation_id: 'dead1', filing: 'admin' }, ctx)).toMatchObject({ isError: true, text: 'That conversation is no longer in Gmail' })
    expect(calls.fileThread).toHaveLength(1)
  })
})
