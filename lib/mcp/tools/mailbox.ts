import type { McpTool, McpToolResult } from '@/lib/mcp/server'
import { spokenDate } from '@/lib/mcp/tools/work-orders'
import { plainTextToRichHtml } from '@/lib/email/rich-text'
import { getMailbox } from '@/lib/mail/sync'
import { getThreadDetail, listFolder, listThreadsById, searchFolder, type ThreadListItem } from '@/lib/mail/list'
import { applyThreadAction, MAX_THREADS_PER_ACTION } from '@/lib/mail/actions'
import { ACTION_DONE, FOLDERS, isFolderKey, isMailAction, type FolderKey } from '@/lib/mail/folders'
import { isFiling } from '@/lib/mail/filing'
import { ComposeError, describeDraft, openDraft, saveDraft, sendDraft, startCompose } from '@/lib/mail/compose'
import { isComposeMode, readAddressInput, type ComposeState, type DraftAttachment } from '@/lib/mail/compose-rules'
import { scheduleDraft } from '@/lib/mail/scheduled'
import { parseSendAt, spokenSendAt } from '@/lib/mail/schedule-rules'
import { messageText } from '@/lib/mail/message'
import { FileThreadError, fileThread } from '@/lib/mail/file-thread'
import { listJobAttachables } from '@/lib/mail/job-files'
import { isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'
import {
  ATTACH_PROPERTIES, fitJobAttachments, hasAttachArgs, loadJobAttachments, skippedText, storeJobAttachments, type JobAttachment,
} from '@/lib/mcp/tools/job-attachments'
import { CATEGORIES, cardsForThreads, isCategory, starredThreadIds, type RowStar } from '@/lib/actions/cards'
import type { SupabaseClient } from '@supabase/supabase-js'

// The office mailbox by voice — the Mail page's own functions (lib/mail):
// what's in a folder or a search, reading a conversation, archive / bin /
// spam / read state, and writing, replying, forwarding or scheduling an email
// (saved as a Gmail draft and sent, exactly as the page's Send does), or
// saving a draft for the user to finish — with a job's photos, files and
// documents attached as the composer's "Attach from job" does.

const DEFAULT_LIST = 10
const MAX_LIST = 25
const MESSAGE_CHARS = 4000
const DUPLICATE_WINDOW_MINUTES = 10
const THREAD_ID_RE = /^[0-9a-f]+$/i
/** Gmail draft ids look like r-8452013… */
const DRAFT_ID_RE = /^[\w-]{1,64}$/

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function who(t: ThreadListItem, folder: FolderKey): string {
  if (folder === 'sent' || folder === 'drafts') {
    return `to ${t.recipients.map(r => r.name || r.email).join(', ') || 'no one yet'}`
  }
  return `from ${t.participants.filter(p => !p.me).map(p => p.name || p.email).join(', ') || 'us'}`
}

const unreadOnly = (args: Record<string, unknown>) => args.unread_only === true

const starLabel = (s: RowStar | undefined) => (s ? CATEGORIES.find(c => c.key === s.category)?.label ?? null : null)

const threadSummary = (t: ThreadListItem, star?: RowStar) => ({
  conversation_id: t.id,
  subject: t.subject,
  snippet: t.snippet,
  from: t.participants.map(p => (p.me ? 'us' : p.name ? `${p.name} <${p.email}>` : p.email)),
  to: t.recipients.map(r => r.email),
  last_message: t.last_message_at,
  messages: t.message_count,
  unread: t.unread,
  attachments: t.has_attachments,
  job_number: t.job?.job_number ?? null,
  filing: t.filing,
  star: star?.category ?? null,
})

export const listMailbox: McpTool = {
  name: 'list_mailbox',
  title: 'List mailbox',
  description: [
    'Conversations in the office Gmail mailbox, newest first — the Mail page\'s list: who, subject, the start of the latest message, unread, and the job it\'s filed on.',
    'folder: inbox (default; its Primary tab), sent, drafts, all, spam or trash (the Bin).',
    'search takes Gmail search syntax (from:castle, subject:quote, has:attachment, newer_than:2d) and reaches all mail, not just recent.',
    'filing: to_file lists emails not on a job yet (the old unlinked inbox). starred: true lists the Mail page\'s Starred folder (starred emails — the to-do list; star narrows it to one star). Each shows its star if starred, and its job_number when it\'s on a job.',
    'Gmail\'s own search also works (is:starred, label:…). Use read_conversation to read one, organise_emails to archive or bin, send_email to reply, star_email to star it.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      folder: { type: 'string', enum: FOLDERS.map(f => f.key) },
      unread_only: { type: 'boolean', description: 'Only unread conversations.' },
      search: { type: 'string', description: 'Gmail search, e.g. "from:castle newer_than:7d".' },
      filing: { type: 'string', enum: ['job', 'to_file', 'admin'], description: 'Only conversations on a job, still to file on one, or filed as admin.' },
      starred: { type: 'boolean', description: 'Only starred conversations (the Starred folder); folder and search are then ignored.' },
      star: { type: 'string', enum: CATEGORIES.map(c => c.key), description: 'With starred: only this star.' },
      limit: { type: 'number', description: `How many (default ${DEFAULT_LIST}, max ${MAX_LIST}).` },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  permission: 'mail.view',

  async run(args, ctx): Promise<McpToolResult> {
    const folder = isFolderKey(args.folder) ? args.folder : 'inbox'
    const limit = Math.min(MAX_LIST, Math.max(1, Math.round(Number(args.limit) || DEFAULT_LIST)))
    const q = [str(args.search), args.unread_only === true ? 'is:unread' : ''].filter(Boolean).join(' ')
    const mailbox = await getMailbox(ctx.tenantId)
    const tab = folder === 'inbox' ? 'primary' : null
    const filing = isFiling(args.filing) ? args.filing : null
    // The Starred folder, as the Mail page shows it: conversations with a live card
    const starred = args.starred === true || isCategory(args.star)
    const star = isCategory(args.star) ? args.star : null
    const page = starred
      ? await listThreadsById(mailbox, await starredThreadIds(ctx.supabase as unknown as SupabaseClient, ctx.tenantId, star))
      : q ? await searchFolder(mailbox, folder, tab, q, null, undefined, filing) : await listFolder(mailbox, folder, tab, null, undefined, filing)
    const all = starred && unreadOnly(args) ? page.threads.filter(t => t.unread) : page.threads
    const threads = all.slice(0, limit)
    const label = starred ? `Starred${star ? ` (${CATEGORIES.find(c => c.key === star)!.label})` : ''}` : FOLDERS.find(f => f.key === folder)!.label
    // Each one's star (its action card), if it has one
    const stars = await cardsForThreads(ctx.supabase as unknown as SupabaseClient, ctx.tenantId, threads.map(t => t.id))
    if (!threads.length) {
      return { text: q && !starred ? `Nothing in ${label} matches "${q}".` : `Nothing in ${label}.`, data: { folder: starred ? 'starred' : folder, conversations: [] } }
    }
    const lines = threads.map(t =>
      `- ${t.unread ? '(unread) ' : ''}${t.last_message_at ? spokenDate(t.last_message_at) : ''}, ${who(t, folder)}: "${t.subject || '(no subject)'}" — ${t.snippet || '(no text)'}` +
      `${t.message_count > 1 ? ` [${t.message_count} messages]` : ''}${t.has_attachments ? ' [attachments]' : ''}${t.job ? ` [${t.job.job_number}]` : t.filing === 'to_file' ? ' [not on a job]' : ''}` +
      `${stars[t.id] ? ` [starred: ${starLabel(stars[t.id])}]` : ''}`)
    return {
      text: [`${label}${q && !starred ? ` matching "${q}"` : ''}${starred && all.length > threads.length ? ` — the newest ${threads.length} of ${all.length}` : ''}:`, ...lines].join('\n'),
      data: { folder: starred ? 'starred' : folder, conversations: threads.map(t => threadSummary(t, stars[t.id])) },
    }
  },
}

export const readConversation: McpTool = {
  name: 'read_conversation',
  title: 'Read conversation',
  description: [
    'Reads a conversation from list_mailbox in full: each message\'s sender, recipients, date, attachments and text (oldest first), and the job it\'s on.',
    'Each message has a message_id for send_email (reply, reply_all, forward); a draft has a draft_id for save_draft. Reading doesn\'t mark it read — organise_emails does.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { conversation_id: { type: 'string', description: 'conversation_id from list_mailbox.' } },
    required: ['conversation_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  permission: 'mail.view',

  async run(args, ctx): Promise<McpToolResult> {
    const id = str(args.conversation_id)
    if (!THREAD_ID_RE.test(id)) return { text: 'Conversation not found — use list_mailbox for its id.', isError: true }
    const detail = await getThreadDetail(await getMailbox(ctx.tenantId), id)
    if (!detail) return { text: 'That conversation no longer exists.', isError: true }

    const messages = detail.messages.map(m => {
      const text = messageText(m)
      const draft = m.labelIds.includes('DRAFT')
      return {
        message_id: m.id,
        draft,
        ...(draft ? { draft_id: detail.drafts.find(d => d.messageId === m.id)?.draftId ?? null } : {}),
        from: m.from ? (m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email) : 'unknown',
        to: m.to.map(a => a.email),
        cc: m.cc.map(a => a.email),
        date: m.date,
        attachments: m.attachments.filter(a => !a.inline).map(a => a.filename),
        text: text.length > MESSAGE_CHARS ? `${text.slice(0, MESSAGE_CHARS)}… (cut short)` : text,
      }
    })
    return {
      text: [
        `"${detail.subject || '(no subject)'}"${detail.job ? ` — on ${detail.job.job_number}` : ''}, ${messages.length} message${messages.length === 1 ? '' : 's'}:`,
        ...messages.map(m => [
          '',
          `${m.draft ? '[DRAFT] ' : ''}From ${m.from}${m.date ? `, ${spokenDate(m.date)}` : ''}. To ${m.to.join(', ') || 'no one'}${m.cc.length ? `, cc ${m.cc.join(', ')}` : ''}.`,
          ...(m.attachments.length ? [`Attachments: ${m.attachments.join(', ')}.`] : []),
          m.text || '(no text)',
        ].join('\n')),
      ].join('\n'),
      data: { conversation_id: detail.id, subject: detail.subject, job_number: detail.job?.job_number ?? null, labels: detail.label_ids, messages },
    }
  },
}

export const organiseEmails: McpTool = {
  name: 'organise_emails',
  title: 'Organise emails',
  description: [
    'Archive, move to the Bin (recoverable for 30 days), report spam, move back to the inbox, or mark read / unread — conversations from list_mailbox, as the Mail page\'s buttons do (changes Gmail too).',
    'For archive, trash and spam, ONLY call after saying which conversations (sender and subject) and getting a clear yes.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      conversation_ids: { type: 'array', items: { type: 'string' }, description: 'conversation_id values from list_mailbox.' },
      action: { type: 'string', enum: ['archive', 'trash', 'spam', 'not_spam', 'inbox', 'read', 'unread'] },
    },
    required: ['conversation_ids', 'action'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  permission: 'mail.organise',

  async run(args, ctx): Promise<McpToolResult> {
    const action = args.action
    if (!isMailAction(action) || action === 'untrash') return { text: 'Unknown action.', isError: true }
    const ids = Array.isArray(args.conversation_ids)
      ? [...new Set(args.conversation_ids.map(str).filter(id => THREAD_ID_RE.test(id)))]
      : []
    if (!ids.length) return { text: 'Which conversations? Use list_mailbox for their ids.', isError: true }
    if (ids.length > MAX_THREADS_PER_ACTION) return { text: `At most ${MAX_THREADS_PER_ACTION} at a time.`, isError: true }

    const mailbox = await getMailbox(ctx.tenantId)
    const result = await applyThreadAction(mailbox, ids, action)
    const done = ACTION_DONE[action]
    const n = result.done.length
    if (!n) return { text: 'Gmail didn\'t accept the change.', data: result, isError: true }
    return {
      text: `${n} conversation${n === 1 ? '' : 's'} ${done}.${result.failed.length ? ` ${result.failed.length} couldn't be changed.` : ''}`,
      data: result,
    }
  },
}

/** Was this text sent to this address in the last few minutes? (the sent copy, filed by the Gmail webhook) */
async function recentlySent(ctx: Parameters<McpTool['run']>[1], to: string, body: string): Promise<boolean> {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60_000).toISOString()
  const { data, error } = await ctx.supabase
    .from('communications').select('content, to_email')
    .eq('tenant_id', ctx.tenantId).eq('type', 'email').eq('direction', 'outbound').gte('created_at', since)
  if (error) throw error
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const start = norm(body).slice(0, 200)
  return (data ?? []).some(r => (r.to_email ?? '').toLowerCase().includes(to.toLowerCase()) && norm(r.content ?? '').startsWith(start))
}

const attachedBytes = (list: DraftAttachment[]) => list.reduce((n, a) => n + (a.size || 0), 0)

/** A draft saved earlier (an action card's email edited in the composer), sent or scheduled as it is */
async function sendSavedDraft(draftId: string, sendAt: string | null, ctx: Parameters<McpTool['run']>[1]): Promise<McpToolResult> {
  if (!/^[A-Za-z0-9_-]+$/.test(draftId)) return { text: 'Draft not found.', isError: true }
  const { to, subject, exists } = await describeDraft(draftId)
  if (!exists) return { text: 'That draft no longer exists — it may have been sent or discarded in Gmail.', isError: true }
  if (to === 'no recipients') return { text: 'Who should it go to? The draft has no recipient.', isError: true }
  const mailbox = await getMailbox(ctx.tenantId)
  try {
    if (sendAt) {
      const scheduled = await scheduleDraft(mailbox, ctx.userId || null, draftId, sendAt)
      return { text: `Scheduled "${subject}" to ${to} for ${spokenSendAt(scheduled.send_at)}. It's in Drafts until then.`, data: { draft_id: draftId, to, subject, send_at: scheduled.send_at } }
    }
    await sendDraft(mailbox, draftId)
    return { text: `Sent "${subject}" to ${to}.`, data: { draft_id: draftId, to, subject } }
  } catch (err) {
    if (err instanceof ComposeError) return { text: err.message, isError: true }
    throw err
  }
}

export const sendEmailTool: McpTool = {
  name: 'send_email',
  title: 'Send email',
  description: [
    'Writes and sends an email from the office mailbox, as the Mail page does: a new email, or a reply, reply all or forward of a message from read_conversation (the conversation_id alone answers its latest message).',
    'Replies go to the sender (reply_all adds everyone else) in the same conversation with the quoted email underneath; the company signature is added. to/cc/bcc replace the usual recipients.',
    'Write the body as plain text in the user\'s words (a short greeting and sign-off are fine; don\'t add commitments they didn\'t make).',
    'send_at (Perth time, e.g. "2026-10-26T08:00") schedules it instead. To leave it for the user to review and send, use save_draft instead.',
    'ONLY call this after reading back who it goes to, the subject, the whole text, the attachments and when it will send, and the user has clearly said yes.',
    'job_number files the email on that job (a new email\'s subject defaults to "job number - address"). attach_photos / attach_files / attach_documents attach that job\'s photos ("2", "45-47", a label), files, and quotes/reports/invoices as PDFs; photos are compressed if the total is over Gmail\'s 25 MB.',
    'draft_id sends a draft saved earlier (e.g. an action card\'s email edited in the app) exactly as it is, or schedules it with send_at; leave out body then.',
    'To email quotes, reports and invoices to the insurer with the standard template (and mark them sent) use send_documents instead.',
    'The same text to the same person within 10 minutes is refused as a likely repeat unless send_anyway: true. If a call returns an error, tell the user what it says instead of retrying.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['new', 'reply', 'reply_all', 'forward'], description: 'Default new.' },
      message_id: { type: 'string', description: 'For reply / reply_all / forward: message_id from read_conversation.' },
      conversation_id: { type: 'string', description: 'For reply / reply_all / forward: answers the conversation\'s latest message.' },
      to: { type: 'string', description: 'Addresses, comma separated. Required for new and forward.' },
      cc: { type: 'string' },
      bcc: { type: 'string' },
      subject: { type: 'string', description: 'Required for new; replies keep "Re: …".' },
      body: { type: 'string', description: 'The text, plain.' },
      send_at: { type: 'string', description: 'Schedule for this Perth date and time instead of sending now.' },
      draft_only: { type: 'boolean', description: 'Save to Drafts, don\'t send.' },
      send_anyway: { type: 'boolean', description: 'The user confirmed sending the same email again.' },
      job_number: { type: 'string', description: 'The job it\'s about, e.g. IRC1001: the sent email is filed on it. Required with attachments.' },
      ...ATTACH_PROPERTIES,
      draft_id: { type: 'string', description: 'Send this saved draft as it is (body, to and subject are the draft\'s).' },
    },
    required: [],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  permission: 'mail.send',

  async run(args, ctx): Promise<McpToolResult> {
    const mode = args.mode === undefined ? 'new' : args.mode
    if (!isComposeMode(mode)) return { text: 'mode must be new, reply, reply_all or forward.', isError: true }
    const sendAt = str(args.send_at) ? parseSendAt(str(args.send_at)) : null
    if (str(args.send_at) && !sendAt) return { text: 'send_at must be a date and time, e.g. 2026-10-26T08:00.', isError: true }
    if (str(args.draft_id)) return sendSavedDraft(str(args.draft_id), sendAt, ctx)
    const body = str(args.body)
    if (!body) return { text: 'What should the email say?', isError: true }

    const mailbox = await getMailbox(ctx.tenantId)

    let messageId = str(args.message_id) || null
    if (mode !== 'new' && !messageId) {
      const conversationId = str(args.conversation_id)
      if (!THREAD_ID_RE.test(conversationId)) return { text: 'Which email? Give message_id or conversation_id from read_conversation.', isError: true }
      const detail = await getThreadDetail(mailbox, conversationId)
      messageId = detail?.messages.filter(m => !m.labelIds.includes('DRAFT')).at(-1)?.id ?? null
      if (!messageId) return { text: 'That conversation no longer exists.', isError: true }
    }
    if (messageId && !THREAD_ID_RE.test(messageId)) return { text: 'Message not found — use read_conversation for its message_id.', isError: true }

    let job: { id: string; job_number: string } | null = null
    if (str(args.job_number)) {
      const found = await jobFromArgs(args, ctx)
      if (isToolResult(found)) return found
      job = found
    } else if (hasAttachArgs(args)) {
      return { text: 'Which job are the attachments from? Give job_number.', isError: true }
    }
    const draftOnly = args.draft_only === true

    try {
      let loaded: JobAttachment[] = []
      if (job && hasAttachArgs(args)) {
        const found = await loadJobAttachments(args, ctx, job)
        if (isToolResult(found)) return found
        loaded = found
      }

      const start = await startCompose(mailbox, mode, messageId, job?.id ?? null)
      const state: ComposeState = {
        ...start,
        to: typeof args.to === 'string' ? args.to : start.to,
        cc: typeof args.cc === 'string' ? args.cc : start.cc,
        bcc: typeof args.bcc === 'string' ? args.bcc : start.bcc,
        subject: str(args.subject) || start.subject,
        body: plainTextToRichHtml(body),
      }

      // Fitted under Gmail's limit: sending never drops an attachment silently
      const fit = await fitJobAttachments(loaded, attachedBytes(state.attachments))
      if (fit.skipped.length && !draftOnly) return { text: `Not sent. ${skippedText(fit)} Send them in a second email.`, isError: true }

      const recipients = [state.to, state.cc, state.bcc].flatMap(v => readAddressInput(v).addresses)
      if (!draftOnly) {
        if (!recipients.length) return { text: 'Who should it go to? There\'s no recipient.', isError: true }
        if (!state.subject.trim()) return { text: 'What\'s the subject?', isError: true }
        if (args.send_anyway !== true && !sendAt && await recentlySent(ctx, recipients[0].email, body)) {
          return {
            text: `Not sent: the same email went to ${recipients[0].email} in the last ${DUPLICATE_WINDOW_MINUTES} minutes. Ask the user if they really want it sent again; if so, call again with send_anyway: true.`,
            isError: true,
          }
        }
      }
      // The job's photos and files, copied into the draft as the composer does
      state.attachments = [...state.attachments, ...await storeJobAttachments(ctx, fit.kept)]

      const saved = await saveDraft(mailbox, ctx.tenantId, ctx.userId || null, state)
      const toText = recipients.map(r => r.email).join(', ') || 'no one yet'
      const attached = state.attachments.length
      const withFiles = attached ? ` with ${attached} attachment${attached === 1 ? '' : 's'}` : ''
      const data = { draft_id: saved.draftId, conversation_id: saved.threadId, to: toText, subject: state.subject, job_number: job?.job_number ?? null, attachments: state.attachments.map(a => a.filename), compressed: fit.compressed }
      if (draftOnly) return { text: `Saved to Drafts: "${state.subject || '(no subject)'}" to ${toText}${withFiles}.${fit.skipped.length ? ` ${skippedText(fit)}` : ''}`, data }
      if (sendAt) {
        const scheduled = await scheduleDraft(mailbox, ctx.userId || null, saved.draftId, sendAt)
        return { text: `Scheduled "${state.subject}" to ${toText}${withFiles} for ${spokenSendAt(scheduled.send_at)}. It's in Drafts until then.`, data: { ...data, send_at: scheduled.send_at } }
      }
      await sendDraft(mailbox, saved.draftId)
      return { text: `Sent "${state.subject}" to ${toText}${withFiles}.`, data }
    } catch (err) {
      if (err instanceof ComposeError) return { text: err.message, isError: true }
      throw err
    }
  },
}

/** The job a draft is filed on, for attaching its photos */
async function jobById(ctx: Parameters<McpTool['run']>[1], id: string | null): Promise<{ id: string; job_number: string } | null> {
  if (!id) return null
  const { data, error } = await ctx.supabase.from('jobs').select('id, job_number').eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle()
  if (error) throw error
  return data ?? null
}

export const saveDraftTool: McpTool = {
  name: 'save_draft',
  title: 'Save draft',
  description: [
    'Creates or edits a draft in the office Gmail Drafts for the user to check and send themselves — nothing is sent. Use when the user says "draft" or wants to review first.',
    'New: like send_email (mode, message_id / conversation_id, to, subject, body). Edit: pass draft_id (from save_draft or read_conversation); only the fields given change and its attachments are kept unless named in remove_attachments.',
    'job_number plus attach_photos ("2", "45-47", a label) / attach_files / attach_documents (quotes, reports, invoices as PDFs) adds the job\'s files; photos are compressed if over Gmail\'s 25 MB.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      draft_id: { type: 'string', description: 'Edit this draft (from save_draft or read_conversation).' },
      mode: { type: 'string', enum: ['new', 'reply', 'reply_all', 'forward'], description: 'New drafts only. Default new.' },
      message_id: { type: 'string', description: 'For a reply / forward draft: message_id from read_conversation.' },
      conversation_id: { type: 'string', description: 'For a reply / forward draft: answers the conversation\'s latest message.' },
      to: { type: 'string', description: 'Addresses, comma separated.' },
      cc: { type: 'string' },
      bcc: { type: 'string' },
      subject: { type: 'string' },
      body: { type: 'string', description: 'The text, plain. Replaces the draft\'s text when editing.' },
      job_number: { type: 'string', description: 'The job it\'s about, e.g. IRC1055. Needed for attachments unless the draft is already on a job.' },
      ...ATTACH_PROPERTIES,
      remove_attachments: { type: 'array', items: { type: 'string' }, description: 'Editing: attachment file names to take off, or ["all"].' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  permission: 'mail.send',
  // Writing a draft is allowed at "needs approval"; sending it is what's approved
  runsAtApproval: true,

  async run(args, ctx): Promise<McpToolResult> {
    const draftId = str(args.draft_id)
    if (draftId && !DRAFT_ID_RE.test(draftId)) return { text: 'Draft not found — use read_conversation for its draft_id.', isError: true }
    const mailbox = await getMailbox(ctx.tenantId)

    let job: { id: string; job_number: string } | null = null
    if (str(args.job_number)) {
      const found = await jobFromArgs(args, ctx)
      if (isToolResult(found)) return found
      job = found
    }

    try {
      let state: ComposeState
      if (draftId) {
        state = await openDraft(mailbox, ctx.tenantId, draftId)
        if (typeof args.to === 'string') state.to = args.to
        if (typeof args.cc === 'string') state.cc = args.cc
        if (typeof args.bcc === 'string') state.bcc = args.bcc
        if (str(args.subject)) state.subject = str(args.subject)
        if (str(args.body)) state.body = plainTextToRichHtml(str(args.body))
        if (job) state.jobId = job.id
        else job = await jobById(ctx, state.jobId)

        // Gmail replaces a draft's attachments on every save, so the kept ones go again
        const remove = Array.isArray(args.remove_attachments) ? args.remove_attachments.map(str).filter(Boolean) : []
        if (remove.some(r => r.toLowerCase() === 'all')) state.attachments = []
        else if (remove.length) {
          const missing = remove.filter(r => !state.attachments.some(a => a.filename.toLowerCase().includes(r.toLowerCase())))
          if (missing.length) {
            return { text: `No attachment ${missing.map(m => `"${m}"`).join(', ')} on the draft. It has: ${state.attachments.map(a => a.filename).join(', ') || 'none'}.`, isError: true }
          }
          state.attachments = state.attachments.filter(a => !remove.some(r => a.filename.toLowerCase().includes(r.toLowerCase())))
        }
      } else {
        const mode = args.mode === undefined ? 'new' : args.mode
        if (!isComposeMode(mode)) return { text: 'mode must be new, reply, reply_all or forward.', isError: true }
        if (!str(args.body)) return { text: 'What should the draft say?', isError: true }
        let messageId = str(args.message_id) || null
        if (mode !== 'new' && !messageId) {
          const conversationId = str(args.conversation_id)
          if (!THREAD_ID_RE.test(conversationId)) return { text: 'Which email? Give message_id or conversation_id from read_conversation.', isError: true }
          const detail = await getThreadDetail(mailbox, conversationId)
          messageId = detail?.messages.filter(m => !m.labelIds.includes('DRAFT')).at(-1)?.id ?? null
          if (!messageId) return { text: 'That conversation no longer exists.', isError: true }
        }
        if (messageId && !THREAD_ID_RE.test(messageId)) return { text: 'Message not found — use read_conversation for its message_id.', isError: true }
        const start = await startCompose(mailbox, mode, messageId, job?.id ?? null)
        state = {
          ...start,
          to: typeof args.to === 'string' ? args.to : start.to,
          cc: typeof args.cc === 'string' ? args.cc : start.cc,
          bcc: typeof args.bcc === 'string' ? args.bcc : start.bcc,
          subject: str(args.subject) || start.subject,
          body: plainTextToRichHtml(str(args.body)),
        }
        if (!job) job = await jobById(ctx, state.jobId)
      }

      let skipped = ''
      let compressed: string[] = []
      if (hasAttachArgs(args)) {
        if (!job) return { text: 'Which job are the attachments from? Give job_number.', isError: true }
        const loaded = await loadJobAttachments(args, ctx, job)
        if (isToolResult(loaded)) return loaded
        const fit = await fitJobAttachments(loaded, attachedBytes(state.attachments))
        state.attachments = [...state.attachments, ...await storeJobAttachments(ctx, fit.kept)]
        skipped = skippedText(fit)
        compressed = fit.compressed
      }

      const saved = await saveDraft(mailbox, ctx.tenantId, ctx.userId || null, state)
      const toText = [state.to, state.cc, state.bcc].flatMap(v => readAddressInput(v).addresses).map(r => r.email).join(', ') || 'no one yet'
      const files = state.attachments.map(a => a.filename)
      return {
        text: [
          `Draft ${draftId ? 'updated' : 'saved'}: "${state.subject || '(no subject)'}" to ${toText}${files.length ? `, attached ${files.join(', ')}` : ''}.`,
          ...(compressed.length ? [`Compressed to fit: ${compressed.join(', ')}.`] : []),
          ...(skipped ? [skipped] : []),
        ].join(' '),
        data: { draft_id: saved.draftId, conversation_id: saved.threadId, to: toText, subject: state.subject, job_number: job?.job_number ?? null, attachments: files, compressed },
      }
    } catch (err) {
      if (err instanceof ComposeError) return { text: err.message, isError: true }
      throw err
    }
  },
}

export const fileConversation: McpTool = {
  name: 'file_conversation',
  title: 'File conversation',
  description: [
    'Files a conversation from list_mailbox on a job (moving it from any other job), or as admin (not job related), or back to "to file" — the Mail page\'s job panel.',
    'Give job_number, or filing: admin / to_file. Confirm the conversation and job with the user first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      conversation_id: { type: 'string', description: 'conversation_id from list_mailbox.' },
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' },
      filing: { type: 'string', enum: ['admin', 'to_file'] },
    },
    required: ['conversation_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  permission: 'orders.manage',

  async run(args, ctx): Promise<McpToolResult> {
    const id = str(args.conversation_id)
    if (!THREAD_ID_RE.test(id)) return { text: 'Conversation not found — use list_mailbox for its id.', isError: true }
    const filing = args.filing === 'admin' || args.filing === 'to_file' ? args.filing : null
    let job: { id: string; job_number: string } | null = null
    if (str(args.job_number)) {
      const found = await jobFromArgs(args, ctx)
      if (isToolResult(found)) return found
      job = found
    }
    if (!job && !filing) return { text: 'Which job (job_number), or filing admin / to_file?', isError: true }
    try {
      await fileThread(await getMailbox(ctx.tenantId), id, job ? { jobId: job.id } : { filing: filing! })
    } catch (err) {
      if (err instanceof FileThreadError) return { text: err.message, isError: true }
      throw err
    }
    return {
      text: job ? `Filed on ${job.job_number}.` : filing === 'admin' ? 'Filed as admin.' : 'Moved back to To file.',
      data: { conversation_id: id, job_number: job?.job_number ?? null, filing: job ? 'job' : filing },
    }
  },
}

export const listJobFiles: McpTool = {
  name: 'list_job_files',
  title: 'List job photos and files',
  description: [
    'Lists a job\'s photos (numbered, with labels) and uploaded files. Use the numbers or ids with get_job_photo (to look at one) and attach_photos / attach_files (send_email, save_draft, reply_to_email, send_documents).',
    'For quotes, reports and invoices use list_job_documents.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' } },
    required: ['job_number'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job
    const { files, photos } = await listJobAttachables(ctx.tenantId, job.id)
    const photoLines = photos.map((p, i) => `${i + 1}. ${p.label || p.name}`)
    const fileLines = files.map(f => `${f.name}${f.description ? ` — ${f.description}` : ''}`)
    const text = [
      photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'} on ${job.job_number}: ${photoLines.join('; ')}.` : `No photos on ${job.job_number}.`,
      files.length ? `${files.length} file${files.length === 1 ? '' : 's'}: ${fileLines.join('; ')}.` : 'No uploaded files.',
    ].join(' ')
    return {
      text,
      data: {
        job_number: job.job_number,
        photos: photos.map((p, i) => ({ photo_id: p.id, number: i + 1, label: p.label, filename: p.name, size_bytes: p.size })),
        files: files.map(f => ({ file_id: f.id, name: f.name, description: f.description, size_bytes: f.size, added: f.createdAt })),
      },
    }
  },
}
