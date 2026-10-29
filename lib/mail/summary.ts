import type { gmail_v1 } from 'googleapis'

// Turns Gmail threads into rows for the mail_threads mirror. Pure — no I/O.

export type MailAddress = { name: string; email: string }
export type Participant = MailAddress & { me: boolean }

export type ThreadSummary = {
  subject: string
  snippet: string
  participants: Participant[]
  recipients: MailAddress[]
  last_message_at: string | null
  message_count: number
  label_ids: string[]
  unread: boolean
  has_attachments: boolean
}

type Message = gmail_v1.Schema$Message
type MessagePart = gmail_v1.Schema$MessagePart

export function header(part: MessagePart | undefined, name: string): string {
  const lower = name.toLowerCase()
  return part?.headers?.find(h => h.name?.toLowerCase() === lower)?.value ?? ''
}

/**
 * Splits an address header ("Smith, John" <j@x.com>, b@y.com) into addresses.
 * Commas inside quotes or angle brackets don't split.
 */
export function parseAddresses(value: string): MailAddress[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  let angled = false
  for (const ch of value) {
    if (ch === '"') quoted = !quoted
    else if (ch === '<' && !quoted) angled = true
    else if (ch === '>' && !quoted) angled = false
    if (ch === ',' && !quoted && !angled) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)

  return parts
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      const match = p.match(/^(.*?)\s*<([^>]+)>$/)
      if (match) {
        return { name: match[1].trim().replace(/^["']|["']$/g, '').trim(), email: match[2].trim() }
      }
      return { name: '', email: p.replace(/^["']|["']$/g, '') }
    })
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Gmail snippets come HTML-escaped (&#39;, &amp;) */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

function hasAttachment(part: MessagePart | undefined): boolean {
  if (!part) return false
  // metadata format has no parts — a mixed multipart is how attachments are carried
  if (part.mimeType === 'multipart/mixed') return true
  if (part.filename && part.body?.attachmentId) return true
  return (part.parts ?? []).some(hasAttachment)
}

const labelsOf = (m: Message) => m.labelIds ?? []

/**
 * Summarises a thread fetched with format 'metadata' or 'full'.
 * Returns null for a thread with no messages (deleted).
 * Drafts count towards labels but not the subject, snippet, date or count,
 * the same as Gmail — unless the thread is only a draft.
 */
export function summariseThread(thread: gmail_v1.Schema$Thread): ThreadSummary | null {
  const messages = [...(thread.messages ?? [])].sort(
    (a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0),
  )
  if (messages.length === 0) return null

  const sent = messages.filter(m => !labelsOf(m).includes('DRAFT'))
  const shown = sent.length > 0 ? sent : messages
  const first = shown[0]
  const last = shown[shown.length - 1]

  const participants: Participant[] = []
  for (const m of shown) {
    const [from] = parseAddresses(header(m.payload, 'From'))
    if (!from) continue
    const me = labelsOf(m).includes('SENT') || labelsOf(m).includes('DRAFT')
    if (!participants.some(p => p.email.toLowerCase() === from.email.toLowerCase())) {
      participants.push({ ...from, me })
    }
  }

  const labels = new Set<string>()
  for (const m of messages) for (const l of labelsOf(m)) labels.add(l)

  const latest = messages[messages.length - 1]
  const recipients = parseAddresses(
    [header(latest.payload, 'To'), header(latest.payload, 'Cc')].filter(Boolean).join(', '),
  )

  return {
    subject: header(first.payload, 'Subject') || header(last.payload, 'Subject'),
    snippet: decodeEntities(last.snippet ?? ''),
    participants,
    recipients,
    last_message_at: last.internalDate ? new Date(Number(last.internalDate)).toISOString() : null,
    message_count: shown.length,
    label_ids: [...labels].sort(),
    unread: labels.has('UNREAD'),
    has_attachments: messages.some(m => hasAttachment(m.payload)),
  }
}

/** Every thread touched by a page of Gmail history */
export function historyThreadIds(history: gmail_v1.Schema$History[]): string[] {
  const ids = new Set<string>()
  const add = (m: Message | undefined) => { if (m?.threadId) ids.add(m.threadId) }
  for (const record of history) {
    for (const m of record.messages ?? []) add(m)
    for (const r of record.messagesAdded ?? []) add(r.message)
    for (const r of record.messagesDeleted ?? []) add(r.message)
    for (const r of record.labelsAdded ?? []) add(r.message)
    for (const r of record.labelsRemoved ?? []) add(r.message)
  }
  return [...ids]
}

/** Messages that arrived in the inbox, the ones we sent, and conversations we sent in */
export type Arrivals = { received: { messageId: string; threadId: string }[]; sent?: { messageId: string; threadId: string }[]; sentThreadIds: string[] }

/** What arrived in a page of Gmail history: incoming mail (not spam, drafts or our own) and our sends */
export function historyArrivals(history: gmail_v1.Schema$History[]): Arrivals {
  const received: Arrivals['received'] = []
  const sentMessages: NonNullable<Arrivals['sent']> = []
  const sent = new Set<string>()
  for (const record of history) {
    for (const { message: m } of record.messagesAdded ?? []) {
      if (!m?.id || !m.threadId) continue
      const labels = m.labelIds ?? []
      if (labels.includes('SENT')) {
        sent.add(m.threadId)
        if (!sentMessages.some(s => s.messageId === m.id)) sentMessages.push({ messageId: m.id, threadId: m.threadId })
        continue
      }
      if (labels.some(l => l === 'DRAFT' || l === 'SPAM' || l === 'TRASH')) continue
      if (labels.includes('INBOX') && !received.some(r => r.messageId === m.id)) received.push({ messageId: m.id, threadId: m.threadId })
    }
  }
  return { received, sent: sentMessages, sentThreadIds: [...sent] }
}
