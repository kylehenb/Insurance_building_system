import { randomUUID } from 'crypto'
import { Readable } from 'stream'
import type { gmail_v1 } from 'googleapis'
import { getGmailClient } from '@/lib/gmail/client'
import { buildEmailRaw, formatFromHeader, type EmailAttachment } from '@/lib/email/build-raw'
import { composeEmailBody, richToText, toRichHtml } from '@/lib/email/rich-text'
import { emailSignatureFor, type SignatureTenant } from '@/lib/email/signature'
import { renderStandardEmailHtml, STANDARD_EMAIL_FONT_SIZE } from '@/lib/email/email-html'
import {
  emptyCompose, forwardSubject, isComposeMode, MAX_EMAIL_BYTES, quoteHtml, quoteText, readAddressInput,
  replyRecipients, replySubject, splitQuote, formatAddresses,
  type ComposeMode, type ComposeStart, type ComposeState, type DraftAttachment, type QuotedEmail,
} from './compose-rules'
import { textToHtml } from './html'
import { parseMessage, type MailMessage } from './message'
import { header } from './summary'
import { fetchThreads, mailDb, type Mailbox } from './sync'

// Writing email from the office mailbox. Every email being written is a
// Gmail draft: saving updates the draft, sending sends the draft (so Undo
// send is simply not sending it yet). mail_drafts keeps the text as typed and
// what it quotes, so the app can reopen its own drafts for editing; the Gmail
// copy is the finished email — text, signature, quote and attachments.

export const ATTACHMENT_BUCKET = 'mail-attachments'

export class ComposeError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 413 | 502 = 400) {
    super(message)
    this.name = 'ComposeError'
  }
}

type DraftRow = {
  gmail_draft_id: string
  gmail_message_id: string | null
  thread_id: string | null
  mode: string
  quote_message_id: string | null
  body: string
  include_signature: boolean
  raw_quote: string | null
  in_reply_to: string | null
  references_header: string | null
  attachments: DraftAttachment[]
}

const SIGNATURE_COLUMNS = 'name, trading_name, email_signature, email_signature_image_path, email_signature_image_width, email_signature_image_height'

async function signatureTenant(tenantId: string, db = mailDb()): Promise<SignatureTenant> {
  const { data } = await db.from('tenants').select(SIGNATURE_COLUMNS).eq('id', tenantId).single()
  if (!data) throw new ComposeError('Company not found', 404)
  return data as SignatureTenant
}

function isNotFound(err: unknown): boolean {
  const e = err as { code?: number; status?: number }
  return e?.code === 404 || e?.status === 404
}

async function getMessage(id: string): Promise<gmail_v1.Schema$Message> {
  try {
    const res = await getGmailClient().users.messages.get({ userId: 'me', id, format: 'full' })
    return res.data
  } catch (err) {
    if (isNotFound(err)) throw new ComposeError('That email no longer exists', 404)
    throw err
  }
}

function quoted(m: MailMessage): QuotedEmail {
  return { from: m.from, to: m.to, cc: m.cc, subject: m.subject, date: m.date, html: m.html, text: m.text }
}

/** Threading headers for a reply to this message */
function threadingHeaders(message: gmail_v1.Schema$Message): { inReplyTo: string | null; references: string | null } {
  const id = header(message.payload, 'Message-ID') || header(message.payload, 'Message-Id')
  if (!id) return { inReplyTo: null, references: null }
  const earlier = header(message.payload, 'References')
  return { inReplyTo: id, references: [earlier, id].filter(Boolean).join(' ') }
}

/** A new reply, reply all or forward of a message, ready to edit */
export async function startCompose(mailbox: Mailbox, mode: ComposeMode, messageId: string | null): Promise<ComposeStart> {
  if (mode === 'new' || !messageId) return { ...emptyCompose(), quoteHtml: '' }

  const original = await getMessage(messageId)
  const m = parseMessage(original)
  const state: ComposeState = { ...emptyCompose(), mode, threadId: m.threadId || null, quoteMessageId: m.id }

  if (mode === 'forward') {
    state.subject = forwardSubject(m.subject)
    // The original's files go with it
    state.attachments = m.attachments
      .filter(a => !a.inline && a.attachmentId)
      .map(a => ({ kind: 'gmail', messageId: m.id, attachmentId: a.attachmentId!, filename: a.filename, mimeType: a.mimeType, size: a.size }))
  } else {
    const { to, cc } = replyRecipients(m, mailbox.email_address, mode === 'reply_all')
    state.to = formatAddresses(to)
    state.cc = formatAddresses(cc)
    state.subject = replySubject(m.subject)
  }
  return { ...state, quoteHtml: quoteHtml(quoted(m), mode) }
}

function plainText(html: string): string {
  return richToText(toRichHtml(html))
}

/** The quote under the text (HTML and plain), and the threading headers */
async function quoteFor(state: ComposeState): Promise<{ html: string; text: string; inReplyTo: string | null; references: string | null }> {
  if (state.rawQuote) {
    return { html: state.rawQuote, text: plainText(state.rawQuote), inReplyTo: state.inReplyTo, references: state.references }
  }
  if (state.quoteMessageId && state.mode !== 'new') {
    const original = await getMessage(state.quoteMessageId)
    const m = parseMessage(original)
    const headers = state.mode === 'forward' ? { inReplyTo: null, references: null } : threadingHeaders(original)
    return { html: quoteHtml(quoted(m), state.mode), text: quoteText(quoted(m), state.mode), ...headers }
  }
  return { html: '', text: '', inReplyTo: state.inReplyTo, references: state.references }
}

async function attachmentContent(tenantId: string, a: DraftAttachment, db = mailDb()): Promise<Buffer> {
  if (a.kind === 'upload') {
    if (!a.path.startsWith(`${tenantId}/`)) throw new ComposeError('Attachment not found', 404)
    const { data, error } = await db.storage.from(ATTACHMENT_BUCKET).download(a.path)
    if (error || !data) throw new ComposeError(`Couldn't read the attachment ${a.filename}`, 502)
    return Buffer.from(await data.arrayBuffer())
  }
  const res = await getGmailClient().users.messages.attachments.get({ userId: 'me', messageId: a.messageId, id: a.attachmentId })
  if (!res.data.data) throw new ComposeError(`Couldn't read the attachment ${a.filename}`, 502)
  return Buffer.from(res.data.data, 'base64url')
}

/** Recipients as a header value, names encoded where needed */
function addressHeader(value: string, label: string): string {
  const { addresses, invalid } = readAddressInput(value)
  if (invalid.length) throw new ComposeError(`${label} has an address that isn't valid: ${invalid.join(', ')}`)
  return addresses.map(a => formatFromHeader(a.email, a.name)).join(', ')
}

/** The finished email (RFC 2822, base64url) for a compose state */
export async function buildMime(mailbox: Mailbox, tenantId: string, state: ComposeState, db = mailDb()): Promise<string> {
  const tenant = await signatureTenant(tenantId, db)
  const companyName = tenant.trading_name || tenant.name
  const body = composeEmailBody(state.body, {
    fontSize: STANDARD_EMAIL_FONT_SIZE,
    signature: state.includeSignature ? emailSignatureFor(tenant) : null,
    signatureFallback: '',
  })
  const quote = await quoteFor(state)

  const attachments: EmailAttachment[] = []
  let total = 0
  for (const a of state.attachments) {
    const content = await attachmentContent(tenantId, a, db)
    total += content.length
    if (total > MAX_EMAIL_BYTES) throw new ComposeError('Attachments are over Gmail\'s 25 MB limit', 413)
    attachments.push({ filename: a.filename, mimeType: a.mimeType || 'application/octet-stream', content })
  }

  return buildEmailRaw({
    from: mailbox.email_address,
    fromName: companyName,
    to: addressHeader(state.to, 'To'),
    cc: addressHeader(state.cc, 'Cc') || undefined,
    bcc: addressHeader(state.bcc, 'Bcc') || undefined,
    subject: state.subject,
    body: [body.text, quote.text].filter(Boolean).join('\n\n'),
    html: renderStandardEmailHtml({ bodyHtml: body.html + (quote.html ? `<br>${quote.html}` : ''), title: companyName }),
    inReplyTo: quote.inReplyTo ?? undefined,
    references: quote.references ?? undefined,
    attachments,
  })
}

// Small emails go as JSON; big ones as an upload (Gmail's limit for raw in JSON is lower)
const JSON_RAW_LIMIT = 4 * 1024 * 1024

function draftBody(raw: string, threadId: string | null) {
  const message = threadId ? { threadId } : {}
  if (raw.length < JSON_RAW_LIMIT) return { requestBody: { message: { ...message, raw } } }
  return {
    requestBody: { message },
    media: { mimeType: 'message/rfc822', body: Readable.from([Buffer.from(raw, 'base64url')]) },
  }
}

async function findRow(mailbox: Mailbox, draftId: string, db = mailDb()): Promise<DraftRow | null> {
  const { data } = await db.from('mail_drafts').select('*').eq('mailbox_id', mailbox.id).eq('gmail_draft_id', draftId).maybeSingle()
  return (data as DraftRow | null) ?? null
}

/** Saves the email as a Gmail draft (new or updated). Returns its ids. */
export async function saveDraft(
  mailbox: Mailbox,
  tenantId: string,
  userId: string | null,
  state: ComposeState,
  db = mailDb(),
): Promise<{ draftId: string; threadId: string | null; messageId: string | null }> {
  if (!isComposeMode(state.mode)) throw new ComposeError('Unknown compose mode')
  const raw = await buildMime(mailbox, tenantId, state, db)
  const gmail = getGmailClient()

  let draft: gmail_v1.Schema$Draft
  try {
    draft = state.draftId
      ? (await gmail.users.drafts.update({ userId: 'me', id: state.draftId, ...draftBody(raw, state.threadId) })).data
      : (await gmail.users.drafts.create({ userId: 'me', ...draftBody(raw, state.threadId) })).data
  } catch (err) {
    // Sent or deleted meanwhile (e.g. in the Gmail app) — keep the writing as a new draft
    if (state.draftId && isNotFound(err)) {
      draft = (await gmail.users.drafts.create({ userId: 'me', ...draftBody(raw, state.threadId) })).data
    } else {
      throw err
    }
  }

  const draftId = draft.id!
  const threadId = draft.message?.threadId ?? state.threadId
  const messageId = draft.message?.id ?? null
  const { error } = await db.from('mail_drafts').upsert({
    tenant_id: tenantId,
    mailbox_id: mailbox.id,
    gmail_draft_id: draftId,
    gmail_message_id: messageId,
    thread_id: threadId,
    mode: state.mode,
    quote_message_id: state.quoteMessageId,
    body: state.body,
    include_signature: state.includeSignature,
    raw_quote: state.rawQuote,
    in_reply_to: state.inReplyTo,
    references_header: state.references,
    attachments: state.attachments,
    created_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'mailbox_id,gmail_draft_id' })
  if (error) console.error('[mail] could not record draft:', error)
  if (state.draftId && state.draftId !== draftId) {
    await db.from('mail_drafts').delete().eq('mailbox_id', mailbox.id).eq('gmail_draft_id', state.draftId)
  }

  if (threadId) await fetchThreads(mailbox, [threadId], db)
  return { draftId, threadId, messageId }
}

async function copyToStorage(tenantId: string, filename: string, mimeType: string, content: Buffer, db = mailDb()): Promise<string> {
  const path = `${tenantId}/${randomUUID()}/${filename.replace(/[/\\]/g, '_')}`
  const { error } = await db.storage.from(ATTACHMENT_BUCKET).upload(path, content, { contentType: mimeType, upsert: false })
  if (error) throw new ComposeError(`Couldn't keep the attachment ${filename}`, 502)
  return path
}

/** A saved draft, ready to edit */
export async function openDraft(mailbox: Mailbox, tenantId: string, draftId: string, db = mailDb()): Promise<ComposeStart> {
  let draft: gmail_v1.Schema$Draft
  try {
    draft = (await getGmailClient().users.drafts.get({ userId: 'me', id: draftId, format: 'full' })).data
  } catch (err) {
    if (isNotFound(err)) throw new ComposeError('This draft no longer exists — it may have been sent or deleted', 404)
    throw err
  }
  const message = draft.message ?? {}
  const m = parseMessage(message)
  const base = {
    draftId,
    threadId: message.threadId ?? null,
    to: header(message.payload, 'To'),
    cc: header(message.payload, 'Cc'),
    bcc: header(message.payload, 'Bcc'),
    subject: m.subject,
  }

  const row = await findRow(mailbox, draftId, db)
  if (row && row.gmail_message_id === message.id) {
    const state: ComposeState = {
      ...emptyCompose(),
      ...base,
      mode: isComposeMode(row.mode) ? row.mode : 'new',
      quoteMessageId: row.quote_message_id,
      rawQuote: row.raw_quote,
      inReplyTo: row.in_reply_to,
      references: row.references_header,
      body: row.body,
      includeSignature: row.include_signature,
      attachments: row.attachments ?? [],
    }
    let shown = row.raw_quote ?? ''
    if (!shown && row.quote_message_id && state.mode !== 'new') {
      try {
        shown = quoteHtml(quoted(parseMessage(await getMessage(row.quote_message_id))), state.mode)
      } catch {
        shown = ''
      }
    }
    return { ...state, quoteHtml: shown }
  }

  // Written or changed in the Gmail app: open it as it is
  const { body, quote } = splitQuote(m.html || textToHtml(m.text))
  const attachments: DraftAttachment[] = []
  for (const a of m.attachments.filter(x => !x.inline && x.attachmentId)) {
    // The draft's own attachment ids end when it's next saved, so keep a copy
    const content = await attachmentContent(tenantId, { kind: 'gmail', messageId: m.id, attachmentId: a.attachmentId!, filename: a.filename, mimeType: a.mimeType, size: a.size }, db)
    attachments.push({ kind: 'upload', path: await copyToStorage(tenantId, a.filename, a.mimeType, content, db), filename: a.filename, mimeType: a.mimeType, size: content.length })
  }
  const inReplyTo = header(message.payload, 'In-Reply-To') || null
  return {
    ...emptyCompose(),
    ...base,
    mode: inReplyTo ? 'reply' : 'new',
    rawQuote: quote,
    inReplyTo,
    references: header(message.payload, 'References') || null,
    body,
    // It already has whatever signature it was written with
    includeSignature: false,
    attachments,
    quoteHtml: quote ?? '',
  }
}

async function removeUploads(row: DraftRow | null, db = mailDb()) {
  const paths = (row?.attachments ?? []).filter(a => a.kind === 'upload').map(a => (a as { path: string }).path)
  if (paths.length) await db.storage.from(ATTACHMENT_BUCKET).remove(paths)
}

/** Discards a draft in Gmail and here */
export async function discardDraft(mailbox: Mailbox, draftId: string, db = mailDb()): Promise<void> {
  const row = await findRow(mailbox, draftId, db)
  let threadId = row?.thread_id ?? null
  try {
    if (!threadId) {
      threadId = (await getGmailClient().users.drafts.get({ userId: 'me', id: draftId, format: 'minimal' })).data.message?.threadId ?? null
    }
    await getGmailClient().users.drafts.delete({ userId: 'me', id: draftId })
  } catch (err) {
    if (!isNotFound(err)) throw err
  }
  await db.from('mail_drafts').delete().eq('mailbox_id', mailbox.id).eq('gmail_draft_id', draftId)
  await unschedule(mailbox, draftId, db)
  await removeUploads(row, db)
  if (threadId) await fetchThreads(mailbox, [threadId], db)
}

/** Sends a saved draft. Returns the sent message. */
export async function sendDraft(mailbox: Mailbox, draftId: string, db = mailDb()): Promise<{ messageId: string | null; threadId: string | null }> {
  const row = await findRow(mailbox, draftId, db)
  let sent: gmail_v1.Schema$Message
  try {
    sent = (await getGmailClient().users.drafts.send({ userId: 'me', requestBody: { id: draftId } })).data
  } catch (err) {
    if (isNotFound(err)) throw new ComposeError('This draft no longer exists — it may already have been sent', 404)
    const message = (err as { message?: string }).message ?? ''
    if (/recipient/i.test(message)) throw new ComposeError('Add at least one recipient', 400)
    throw err
  }
  await db.from('mail_drafts').delete().eq('mailbox_id', mailbox.id).eq('gmail_draft_id', draftId)
  await unschedule(mailbox, draftId, db)
  await removeUploads(row, db)
  if (sent.threadId) await fetchThreads(mailbox, [sent.threadId], db)
  return { messageId: sent.id ?? null, threadId: sent.threadId ?? null }
}

/** "Re: Roof leak" to jane@insurer.com — for approvals and the activity log */
export async function describeDraft(draftId: string): Promise<{ to: string; subject: string; exists: boolean }> {
  try {
    const draft = (await getGmailClient().users.drafts.get({ userId: 'me', id: draftId, format: 'metadata' })).data
    const p = draft.message?.payload
    return { to: [header(p, 'To'), header(p, 'Cc')].filter(Boolean).join(', ') || 'no recipients', subject: header(p, 'Subject') || '(no subject)', exists: true }
  } catch {
    return { to: 'unknown recipients', subject: 'a draft that no longer exists', exists: false }
  }
}

/** Takes a draft off the schedule (sent by hand or discarded) — not one the scheduler is sending */
async function unschedule(mailbox: Mailbox, draftId: string, db = mailDb()) {
  await db.from('scheduled_emails')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('mailbox_id', mailbox.id)
    .eq('gmail_draft_id', draftId)
    .in('status', ['scheduled', 'failed'])
}

/** Gmail drafts in a conversation, oldest first */
export async function draftsInThread(threadId: string): Promise<{ draftId: string; messageId: string }[]> {
  const res = await getGmailClient().users.drafts.list({ userId: 'me', maxResults: 500 })
  return (res.data.drafts ?? [])
    .filter(d => d.message?.threadId === threadId && d.id && d.message?.id)
    .map(d => ({ draftId: d.id!, messageId: d.message!.id! }))
}
