import { cleanEmailHtml, escapeHtml, textToHtml } from './html'
import { parseAddresses, type MailAddress } from './summary'

// Writing email: who a reply goes to, subjects, and the quoted email under a
// reply or forward. Pure — safe for client code.

export type ComposeMode = 'new' | 'reply' | 'reply_all' | 'forward'

export const COMPOSE_MODES: ComposeMode[] = ['new', 'reply', 'reply_all', 'forward']

export function isComposeMode(value: unknown): value is ComposeMode {
  return COMPOSE_MODES.includes(value as ComposeMode)
}

export type DraftAttachment =
  | { kind: 'upload'; path: string; filename: string; mimeType: string; size: number }
  | { kind: 'gmail'; messageId: string; attachmentId: string; filename: string; mimeType: string; size: number }

/** Everything needed to save, reopen or send an email being written */
export type ComposeState = {
  draftId: string | null
  threadId: string | null
  mode: ComposeMode
  /** Gmail id of the email replied to or forwarded */
  quoteMessageId: string | null
  /** Quoted email kept as it was (drafts started in the Gmail app) */
  rawQuote: string | null
  inReplyTo: string | null
  references: string | null
  to: string
  cc: string
  bcc: string
  subject: string
  /** Rich HTML as typed — no signature or quote */
  body: string
  includeSignature: boolean
  attachments: DraftAttachment[]
}

/** A ComposeState plus what the page shows but doesn't edit */
export type ComposeStart = ComposeState & { quoteHtml: string }

/** Gmail's limit for a whole email */
export const MAX_EMAIL_BYTES = 25 * 1024 * 1024

export function emptyCompose(): ComposeState {
  return {
    draftId: null, threadId: null, mode: 'new', quoteMessageId: null, rawQuote: null,
    inReplyTo: null, references: null, to: '', cc: '', bcc: '', subject: '', body: '',
    includeSignature: true, attachments: [],
  }
}

const EMAIL_RE = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]+$/

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim())
}

export function formatAddress(a: MailAddress): string {
  if (!a.name) return a.email
  return /[",<>@]/.test(a.name) ? `"${a.name.replace(/"/g, "'")}" <${a.email}>` : `${a.name} <${a.email}>`
}

export const formatAddresses = (list: MailAddress[]) => list.map(formatAddress).join(', ')

/** Addresses typed in a To/Cc/Bcc box, and any that aren't valid */
export function readAddressInput(value: string): { addresses: MailAddress[]; invalid: string[] } {
  const addresses = parseAddresses(value.replace(/;/g, ','))
  return {
    addresses: addresses.filter(a => isValidEmail(a.email)),
    invalid: addresses.filter(a => !isValidEmail(a.email)).map(a => a.email),
  }
}

const REPLY_PREFIX = /^\s*(re|aw|sv)\s*(\[\d+\])?\s*:/i
const FORWARD_PREFIX = /^\s*(fwd?|fw)\s*:/i

export function replySubject(subject: string): string {
  return REPLY_PREFIX.test(subject) ? subject : `Re: ${subject}`
}

export function forwardSubject(subject: string): string {
  return FORWARD_PREFIX.test(subject) ? subject : `Fwd: ${subject}`
}

/** The email a reply answers, as far as recipients go */
export type OriginalForReply = {
  from: MailAddress | null
  to: MailAddress[]
  cc: MailAddress[]
  replyTo: MailAddress[]
  labelIds: string[]
}

/**
 * Recipients of a reply, as Gmail picks them: the sender (or their Reply-To);
 * replying to our own email goes to its recipients again. Reply all adds the
 * other recipients, leaving out our own address and duplicates.
 */
export function replyRecipients(original: OriginalForReply, ownEmail: string, all: boolean): { to: MailAddress[]; cc: MailAddress[] } {
  const own = ownEmail.toLowerCase()
  const isOwn = (a: MailAddress) => a.email.toLowerCase() === own
  const fromUs = original.labelIds.includes('SENT') || (!!original.from && isOwn(original.from))

  const seen = new Set<string>()
  const keep = (list: MailAddress[]) => list.filter(a => {
    const key = a.email.toLowerCase()
    if (isOwn(a) || seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (fromUs) {
    const to = keep(original.to)
    return { to, cc: all ? keep(original.cc) : [] }
  }
  const primary = original.replyTo.length > 0 ? original.replyTo : original.from ? [original.from] : []
  const to = keep(primary)
  if (!all) return { to, cc: [] }
  return { to: [...to, ...keep(original.to)], cc: keep(original.cc) }
}

/** The email being quoted */
export type QuotedEmail = {
  from: MailAddress | null
  to: MailAddress[]
  cc: MailAddress[]
  subject: string
  date: string | null
  html: string
  text: string
}

/** "Fri, 23 Oct 2026 at 2:39 pm" in Perth time */
export function quoteDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d)
  const time = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
  return `${date} at ${time.replace(/\s/g, ' ').toLowerCase()}`
}

const who = (a: MailAddress | null) => (a ? (a.name ? `${a.name} <${a.email}>` : a.email) : 'unknown sender')

/** The quoted email's own HTML, safe to place inside ours */
function innerHtml(q: QuotedEmail): string {
  if (!q.html) return textToHtml(q.text)
  let html = cleanEmailHtml(q.html)
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)
  if (body) html = body[1]
  return html
    .replace(/<head\b[\s\S]*?<\/head\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<\/?(html|body)\b[^>]*>/gi, '')
    // Its inline images belong to the original email, not this one
    .replace(/<img\b[^>]*\ssrc\s*=\s*["']?cid:[^>]*>/gi, '')
}

/** The quote under a reply or forward, marked up the way Gmail does (class gmail_quote) */
export function quoteHtml(q: QuotedEmail, mode: ComposeMode): string {
  if (mode === 'forward') {
    const lines = [
      '---------- Forwarded message ---------',
      `From: <strong>${escapeHtml(who(q.from))}</strong>`,
      `Date: ${escapeHtml(quoteDate(q.date))}`,
      `Subject: ${escapeHtml(q.subject)}`,
      `To: ${escapeHtml(q.to.map(who).join(', '))}`,
      ...(q.cc.length ? [`Cc: ${escapeHtml(q.cc.map(who).join(', '))}`] : []),
    ]
    return `<div class="gmail_quote"><div class="gmail_attr">${lines.join('<br>')}<br></div><br>${innerHtml(q)}</div>`
  }
  return `<div class="gmail_quote"><div class="gmail_attr">On ${escapeHtml(quoteDate(q.date))}, ${escapeHtml(who(q.from))} wrote:<br></div>` +
    `<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">${innerHtml(q)}</blockquote></div>`
}

export function quoteText(q: QuotedEmail, mode: ComposeMode): string {
  const text = q.text.replace(/\r\n/g, '\n').trimEnd()
  if (mode === 'forward') {
    return [
      '---------- Forwarded message ---------',
      `From: ${who(q.from)}`,
      `Date: ${quoteDate(q.date)}`,
      `Subject: ${q.subject}`,
      `To: ${q.to.map(who).join(', ')}`,
      ...(q.cc.length ? [`Cc: ${q.cc.map(who).join(', ')}`] : []),
      '',
      text,
    ].join('\n')
  }
  return `On ${quoteDate(q.date)}, ${who(q.from)} wrote:\n` + text.split('\n').map(l => `> ${l}`).join('\n')
}

/** Splits an email's HTML into what was written and the quoted email below it */
export function splitQuote(html: string): { body: string; quote: string | null } {
  const at = html.search(/<(div|blockquote)\b[^>]*class\s*=\s*["'][^"']*\bgmail_quote\b/i)
  if (at < 0) return { body: html, quote: null }
  return { body: html.slice(0, at), quote: html.slice(at) }
}
