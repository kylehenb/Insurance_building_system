export interface EmailAttachment {
  filename: string
  mimeType: string
  content: Buffer
}

export interface BuildRawEmailParams {
  from: string
  to: string
  cc?: string
  subject: string
  body: string
  /** RFC 822 Message-ID of the message being replied to, e.g. <CABcd@mail.gmail.com> */
  inReplyTo?: string
  /** Space-separated list of Message-IDs for the References header */
  references?: string
  attachments?: EmailAttachment[]
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

/**
 * Builds a base64url-encoded RFC 2822 raw email string suitable for
 * passing to gmail.users.messages.send({ requestBody: { raw } }).
 * With attachments it becomes multipart/mixed; otherwise plain text.
 */
export function buildEmailRaw(params: BuildRawEmailParams): string {
  const { from, to, cc, subject, body, inReplyTo, references, attachments = [] } = params

  const headers: string[] = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${encodeHeaderValue(subject)}`,
    'MIME-Version: 1.0',
  ]

  if (inReplyTo) {
    headers.push(`In-Reply-To: ${ensureAngleBrackets(inReplyTo)}`)
  }

  if (references) {
    headers.push(`References: ${references}`)
  }

  if (attachments.length === 0) {
    const raw = [...headers, 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n')
    return Buffer.from(raw).toString('base64url')
  }

  const boundary = `irc_${crypto.randomUUID().replace(/-/g, '')}`
  const parts: string[] = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(Buffer.from(body)),
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
