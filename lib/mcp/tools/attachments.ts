import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { getGmailClient } from '@/lib/gmail/client'
import { extractMessageParts, getFullMessage } from '@/lib/gmail/messages'
import { AttachmentReadError, attachmentKind, readAttachment } from '@/lib/attachments/read'

// Reading an email's attachments by voice (PDFs, scans, photos, text files).
// Attachments come from the copy the app stored with the email, or straight
// from Gmail when it has none (e.g. an order email, or an inbox email found
// with find_order_emails).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GMAIL_ID_RE = /^[0-9a-zA-Z]{8,32}$/

interface AttachmentSource {
  filename: string
  mimeType: string
  size: number | null
  load(): Promise<Buffer>
}

interface StoredAttachment { filename?: unknown; storage_path?: unknown; mime_type?: unknown; size_bytes?: unknown }

async function fromGmail(messageId: string): Promise<{ subject: string; attachments: AttachmentSource[] }> {
  const msg = await extractMessageParts(await getFullMessage(messageId))
  return {
    subject: msg.subject,
    attachments: msg.attachments
      .filter(a => a.data)
      .map(a => ({ filename: a.filename, mimeType: a.mimeType, size: a.size, load: async () => Buffer.from(a.data, 'base64') })),
  }
}

/** The email's attachments, or a tool result explaining why there are none to read. */
async function emailAttachments(args: Record<string, unknown>, ctx: McpContext): Promise<{ subject: string; attachments: AttachmentSource[] } | McpToolResult> {
  const emailId = typeof args.email_id === 'string' ? args.email_id.trim() : ''
  const messageId = typeof args.message_id === 'string' ? args.message_id.trim() : ''

  if (emailId) {
    if (!UUID_RE.test(emailId)) return { text: 'Email not found — use list_job_emails for its id.', isError: true }
    const { data, error } = await ctx.supabase
      .from('communications').select('subject, attachments, gmail_message_id')
      .eq('tenant_id', ctx.tenantId).eq('id', emailId).eq('type', 'email').maybeSingle()
    if (error) throw error
    if (!data) return { text: 'Email not found — use list_job_emails for its id.', isError: true }

    const stored = (Array.isArray(data.attachments) ? data.attachments : []) as StoredAttachment[]
    const fromStorage: AttachmentSource[] = stored
      .filter(a => typeof a.filename === 'string' && typeof a.storage_path === 'string')
      .map(a => ({
        filename: a.filename as string,
        mimeType: typeof a.mime_type === 'string' ? a.mime_type : 'application/octet-stream',
        size: typeof a.size_bytes === 'number' ? a.size_bytes : null,
        load: async () => {
          const { data: blob, error: dlErr } = await ctx.supabase.storage.from('job-files').download(a.storage_path as string)
          if (dlErr || !blob) throw new AttachmentReadError(`Couldn't open ${a.filename as string} from storage.`)
          return Buffer.from(await blob.arrayBuffer())
        },
      }))
    if (fromStorage.length) return { subject: data.subject ?? '', attachments: fromStorage }

    // No stored copies (order emails, older emails): fetch from Gmail by its Message-ID
    if (data.gmail_message_id) {
      const rfcId = data.gmail_message_id.replace(/^<|>$/g, '')
      const found = await getGmailClient().users.messages.list({ userId: 'me', q: `rfc822msgid:${rfcId}`, maxResults: 1 })
      const id = found.data.messages?.[0]?.id
      if (id) return fromGmail(id)
    }
    return { subject: data.subject ?? '', attachments: [] }
  }

  if (messageId) {
    if (!GMAIL_ID_RE.test(messageId)) return { text: 'Email not found — use find_order_emails for its id.', isError: true }
    return fromGmail(messageId)
  }
  return { text: 'Which email? Give email_id (from list_job_emails) or message_id (from find_order_emails).', isError: true }
}

const isResult = (v: unknown): v is McpToolResult => !!v && typeof v === 'object' && 'text' in v

const describeFile = (a: AttachmentSource, i: number) =>
  `${i + 1}. ${a.filename}${a.size ? ` (${a.size >= 1024 * 1024 ? `${(a.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(a.size / 1024))} KB`})` : ''}${attachmentKind(a) === 'unsupported' ? ' — can\'t be read here' : ''}`

function pick(attachments: AttachmentSource[], wanted: string): AttachmentSource | null {
  const n = Number(wanted)
  if (Number.isInteger(n) && n >= 1 && n <= attachments.length) return attachments[n - 1]
  const w = wanted.toLowerCase()
  return attachments.find(a => a.filename.toLowerCase() === w)
    ?? attachments.find(a => a.filename.toLowerCase().includes(w))
    ?? null
}

export const readEmailAttachment: McpTool = {
  name: 'read_email_attachment',
  title: 'Read email attachment',
  description: [
    'Reads an attachment on an email — PDFs (typed or scanned), photos and images, and text files — and returns a summary of what it is and what it asks for, then its full contents.',
    'Give email_id (from list_job_emails) or message_id (from find_order_emails). If the email has several attachments and you don\'t say which,',
    'the list comes back so you can ask the user; then pass attachment as its number or file name.',
    'Word and Excel files can\'t be read yet. Reading a long PDF can take up to a minute — tell the user you\'re reading it.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      email_id: { type: 'string', description: 'email_id from list_job_emails or get_email.' },
      message_id: { type: 'string', description: 'message_id from find_order_emails (an inbox email).' },
      attachment: { type: 'string', description: 'Which attachment: its number in the list (1, 2…) or its file name.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const email = await emailAttachments(args, ctx)
    if (isResult(email)) return email
    const { subject, attachments } = email
    const files = attachments.map((a, i) => ({ number: i + 1, filename: a.filename, mime_type: a.mimeType, size_bytes: a.size, readable: attachmentKind(a) !== 'unsupported' }))
    if (!attachments.length) return { text: `"${subject}" has no attachments.`, data: { attachments: [] } }

    const wanted = typeof args.attachment === 'string' ? args.attachment.trim() : ''
    let chosen: AttachmentSource | null
    if (wanted) {
      chosen = pick(attachments, wanted)
      if (!chosen) return { text: `No attachment "${wanted}". The attachments are:\n${attachments.map(describeFile).join('\n')}`, data: { attachments: files }, isError: true }
    } else if (attachments.length === 1) {
      chosen = attachments[0]
    } else {
      return { text: `"${subject}" has ${attachments.length} attachments — which one?\n${attachments.map(describeFile).join('\n')}`, data: { attachments: files } }
    }

    try {
      const reading = await readAttachment({ filename: chosen.filename, mimeType: chosen.mimeType, data: await chosen.load() })
      return {
        text: `${chosen.filename}:\n${reading.text}`,
        data: { attachment: chosen.filename, truncated: reading.truncated, other_attachments: files.filter(f => f.filename !== chosen!.filename) },
      }
    } catch (err) {
      if (err instanceof AttachmentReadError) return { text: err.message, isError: true }
      throw err
    }
  },
}
