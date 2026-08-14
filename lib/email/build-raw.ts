export interface BuildRawEmailParams {
  from: string
  to: string
  subject: string
  body: string
  /** RFC 822 Message-ID of the message being replied to, e.g. <CABcd@mail.gmail.com> */
  inReplyTo?: string
  /** Space-separated list of Message-IDs for the References header */
  references?: string
}

/** Wrap a bare Message-ID string in angle brackets if not already present. */
export function ensureAngleBrackets(id: string): string {
  const trimmed = id.trim()
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed
  return `<${trimmed}>`
}

/**
 * Builds a base64url-encoded RFC 2822 raw email string suitable for
 * passing to gmail.users.messages.send({ requestBody: { raw } }).
 */
export function buildEmailRaw(params: BuildRawEmailParams): string {
  const { from, to, subject, body, inReplyTo, references } = params

  const headers: string[] = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
  ]

  if (inReplyTo) {
    headers.push(`In-Reply-To: ${ensureAngleBrackets(inReplyTo)}`)
  }

  if (references) {
    headers.push(`References: ${references}`)
  }

  const raw = [...headers, '', body].join('\r\n')
  return Buffer.from(raw).toString('base64url')
}
