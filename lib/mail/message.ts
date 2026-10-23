import type { gmail_v1 } from 'googleapis'
import { decodeEntities, header, parseAddresses, type MailAddress } from './summary'

// Parses a Gmail message (format 'full') for the reading pane. Pure — no I/O.
// Attachment bytes are not fetched; the pane links to /api/mail/attachments.

export type MailAttachment = {
  attachmentId: string | null
  filename: string
  mimeType: string
  size: number
  /** Content-ID without angle brackets, for cid: images in the HTML body */
  contentId: string | null
  /** Shown inside the body rather than listed as a file */
  inline: boolean
  /** Small parts Gmail returns inline (no attachmentId), as standard base64 */
  data: string | null
}

export type MailMessage = {
  id: string
  threadId: string
  labelIds: string[]
  from: MailAddress | null
  to: MailAddress[]
  cc: MailAddress[]
  replyTo: MailAddress[]
  subject: string
  date: string | null
  snippet: string
  html: string
  text: string
  attachments: MailAttachment[]
}

type Part = gmail_v1.Schema$MessagePart

function charsetOf(part: Part): string {
  const match = header(part, 'Content-Type').match(/charset="?([^";\s]+)"?/i)
  return match?.[1] ?? 'utf-8'
}

export function decodeBody(data: string, charset = 'utf-8'): string {
  const bytes = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    // Unknown charset label
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function walk(part: Part, out: { html: string[]; text: string[]; attachments: MailAttachment[] }) {
  const mimeType = (part.mimeType ?? '').toLowerCase()
  const disposition = header(part, 'Content-Disposition').toLowerCase()
  const contentId = header(part, 'Content-ID').replace(/^<|>$/g, '').trim() || null
  const isFile = !!part.filename || disposition.startsWith('attachment') || (!!contentId && !mimeType.startsWith('text/'))

  if (isFile) {
    out.attachments.push({
      attachmentId: part.body?.attachmentId ?? null,
      filename: part.filename || contentId || 'attachment',
      mimeType: mimeType || 'application/octet-stream',
      size: part.body?.size ?? 0,
      contentId,
      inline: !!contentId && !disposition.startsWith('attachment'),
      data: part.body?.attachmentId ? null : part.body?.data?.replace(/-/g, '+').replace(/_/g, '/') ?? null,
    })
    return
  }

  if (mimeType === 'text/html' && part.body?.data) {
    out.html.push(decodeBody(part.body.data, charsetOf(part)))
    return
  }
  if (mimeType === 'text/plain' && part.body?.data) {
    out.text.push(decodeBody(part.body.data, charsetOf(part)))
    return
  }

  for (const child of part.parts ?? []) walk(child, out)
}

export function parseMessage(message: gmail_v1.Schema$Message): MailMessage {
  const out = { html: [] as string[], text: [] as string[], attachments: [] as MailAttachment[] }
  if (message.payload) walk(message.payload, out)

  const p = message.payload
  return {
    id: message.id ?? '',
    threadId: message.threadId ?? '',
    labelIds: message.labelIds ?? [],
    from: parseAddresses(header(p, 'From'))[0] ?? null,
    to: parseAddresses(header(p, 'To')),
    cc: parseAddresses(header(p, 'Cc')),
    replyTo: parseAddresses(header(p, 'Reply-To')),
    subject: header(p, 'Subject'),
    date: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
    snippet: decodeEntities(message.snippet ?? ''),
    // Parts of a multipart/alternative are the same content twice — html wins, text is the fallback
    html: out.html.join('<hr>'),
    text: out.text.join('\n\n'),
    attachments: out.attachments,
  }
}

export function attachmentUrl(messageId: string, a: Pick<MailAttachment, 'attachmentId' | 'filename' | 'mimeType'>, download = false): string {
  const params = new URLSearchParams({
    m: messageId,
    a: a.attachmentId ?? '',
    n: a.filename,
    t: a.mimeType,
  })
  if (download) params.set('dl', '1')
  return `/api/mail/attachments?${params}`
}

/** Points cid: images at the attachment route (or a data: URL for small inline parts) */
export function resolveCidImages(html: string, messageId: string, attachments: MailAttachment[]): string {
  if (!html.includes('cid:')) return html
  return html.replace(/(["'(])cid:([^"')\s]+)/gi, (whole, open: string, cid: string) => {
    const a = attachments.find(x => x.contentId && x.contentId.toLowerCase() === decodeURIComponent(cid).toLowerCase())
    if (!a) return whole
    if (a.data) return `${open}data:${a.mimeType};base64,${a.data}`
    if (a.attachmentId) return `${open}${attachmentUrl(messageId, a)}`
    return whole
  })
}

/** A message as plain text: its text part, or its HTML with the tags taken out */
export function messageText(m: Pick<MailMessage, 'text' | 'html'>): string {
  if (m.text.trim()) return m.text.replace(/\r\n/g, '\n').trim()
  return m.html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}
