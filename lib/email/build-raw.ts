export interface EmailAttachment {
  filename: string
  mimeType: string
  content: Buffer
}

export interface BuildRawEmailParams {
  from: string
  /** Sender name shown in the recipient's inbox, e.g. "Insurance Repair Co".
   *  Without it Gmail shows the mailbox account's own name. */
  fromName?: string | null
  to: string
  cc?: string
  /** Blind copy: added as a Bcc header, which Gmail delivers and strips before sending */
  bcc?: string
  subject: string
  body: string
  /** RFC 822 Message-ID of the message being replied to, e.g. <CABcd@mail.gmail.com> */
  inReplyTo?: string
  /** Space-separated list of Message-IDs for the References header */
  references?: string
  attachments?: EmailAttachment[]
  /** Optional HTML version of body. The plain-text body is always sent as well
   *  (multipart/alternative), so mail apps without HTML still get the text. */
  html?: string
}

/** Wrap a bare Message-ID string in angle brackets if not already present. */
export function ensureAngleBrackets(id: string): string {
  const trimmed = id.trim()
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed
  return `<${trimmed}>`
}

// RFC 2047 encoded-word for header values that aren't plain ASCII
// (en dashes in subjects, accented names in filenames).
function encodeHeaderValue(value: string): string {
  if (/^[\x00-\x7f]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`
}

// Base64 body wrapped at 76 chars per RFC 2045.
function base64Lines(content: Buffer): string {
  return content.toString('base64').replace(/.{76}/g, '$&\r\n')
}

/** "Insurance Repair Co" <office@…>, or the bare address without a name. */
export function formatFromHeader(email: string, name?: string | null): string {
  const clean = name?.replace(/[\r\n]+/g, ' ').trim()
  if (!clean) return email
  const display = /^[\x20-\x7e]*$/.test(clean)
    ? `"${clean.replace(/(["\\])/g, '\\$1')}"`
    : encodeHeaderValue(clean)
  return `${display} <${email}>`
}

/**
 * Builds a base64url-encoded RFC 2822 raw email string suitable for
 * passing to gmail.users.messages.send({ requestBody: { raw } }).
 * With attachments it becomes multipart/mixed; with html the text and HTML
 * bodies are multipart/alternative; otherwise plain text.
 */
export function buildEmailRaw(params: BuildRawEmailParams): string {
  const { from, fromName, to, cc, bcc, subject, body, inReplyTo, references, attachments = [], html } = params

  const headers: string[] = [
    `From: ${formatFromHeader(from, fromName)}`,
    // A draft can be saved before it has recipients
    ...(to ? [`To: ${to}`] : []),
    ...(cc ? [`Cc: ${cc}`] : []),
    ...(bcc ? [`Bcc: ${bcc}`] : []),
    `Subject: ${encodeHeaderValue(subject)}`,
    'MIME-Version: 1.0',
  ]

  if (inReplyTo) {
    headers.push(`In-Reply-To: ${ensureAngleBrackets(inReplyTo)}`)
  }

  if (references) {
    headers.push(`References: ${references}`)
  }

  if (attachments.length === 0 && !html) {
    const raw = [...headers, 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n')
    return Buffer.from(raw).toString('base64url')
  }

  const textPart = [
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(Buffer.from(body)),
  ]

  // Text + HTML as alternatives of each other
  let bodyPart = textPart
  if (html) {
    const altBoundary = `irc_alt_${crypto.randomUUID().replace(/-/g, '')}`
    bodyPart = [
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      `--${altBoundary}`,
      ...textPart,
      `--${altBoundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(Buffer.from(html)),
      `--${altBoundary}--`,
    ]
    if (attachments.length === 0) {
      const raw = [...headers, ...bodyPart, ''].join('\r\n')
      return Buffer.from(raw).toString('base64url')
    }
  }

  const boundary = `irc_${crypto.randomUUID().replace(/-/g, '')}`
  const parts: string[] = [
    `--${boundary}`,
    ...bodyPart,
  ]
  for (const att of attachments) {
    const name = encodeHeaderValue(att.filename.replace(/["\\\r\n]/g, ''))
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(att.content),
    )
  }
  parts.push(`--${boundary}--`, '')

  const raw = [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', ...parts].join('\r\n')
  return Buffer.from(raw).toString('base64url')
}
