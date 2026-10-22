import type { McpTool, McpToolResult } from '@/lib/mcp/server'
import { spokenDate } from '@/lib/mcp/tools/work-orders'
import { isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'
import { ReplyError, replyToEmail } from '@/lib/communications/reply'

// Email by voice: what's come in on a job (or isn't on a job yet), reading
// one in full, and replying in its thread with the Reply box's own function
// (lib/communications/reply.ts) — same From address, threading and comms
// record as replying in the app.

const DEFAULT_EMAILS = 10
const MAX_EMAILS = 25
const SNIPPET_CHARS = 280
const FULL_BODY_CHARS = 6000
const UNLINKED_DAYS = 14
/** The same reply text on the same conversation within this window needs send_anyway */
const DUPLICATE_WINDOW_MINUTES = 10

const EMAIL_COLUMNS = 'id, created_at, direction, from_email, to_email, subject, body_text, content, attachments, job_id, thread_id, source'
interface EmailRow {
  id: string
  created_at: string | null
  direction: string | null
  from_email: string | null
  to_email: string | null
  subject: string | null
  body_text: string | null
  content: string | null
  attachments: unknown
  job_id: string | null
  thread_id: string | null
  source: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const bodyOf = (e: EmailRow) => (e.body_text ?? e.content ?? '').trim()

/** The new part of an email: up to the quoted earlier message, whitespace collapsed. */
function snippet(text: string, max = SNIPPET_CHARS): string {
  const quoteAt = text.search(/\n\s*(On .{0,200}wrote:|From: .+\n|-{2,} ?Original Message)/i)
  const fresh = (quoteAt > 0 ? text.slice(0, quoteAt) : text).replace(/\s+/g, ' ').trim()
  return fresh.length > max ? `${fresh.slice(0, max).trimEnd()}…` : fresh
}

function attachmentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(a => (a && typeof a === 'object' && typeof (a as { filename?: unknown }).filename === 'string' ? [(a as { filename: string }).filename] : []))
}

const emailSummary = (e: EmailRow) => ({
  email_id: e.id,
  received: e.created_at,
  direction: e.direction,
  from: e.from_email,
  to: e.to_email,
  subject: e.subject,
  snippet: snippet(bodyOf(e)),
  attachments: attachmentNames(e.attachments),
})

function describe(e: EmailRow): string {
  const who = e.direction === 'outbound' ? `we sent to ${e.to_email ?? 'unknown'}` : `from ${e.from_email ?? 'unknown'}`
  const files = attachmentNames(e.attachments)
  return `- ${e.created_at ? spokenDate(e.created_at) : ''}, ${who}: "${e.subject ?? '(no subject)'}" — ${snippet(bodyOf(e)) || '(no text)'}${files.length ? ` [${files.length} attachment${files.length === 1 ? '' : 's'}]` : ''}`
}

export const listJobEmails: McpTool = {
  name: 'list_job_emails',
  title: 'List job emails',
  description: [
    'The most recent emails on a job, newest first — who from (or who we sent to), subject, and the start of the new text.',
    `Leave out job_number for recent incoming emails that aren't on any job yet (last ${UNLINKED_DAYS} days).`,
    'Use get_email to read one in full, and reply_to_email to answer one.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' },
      limit: { type: 'number', description: `How many (default ${DEFAULT_EMAILS}, max ${MAX_EMAILS}).` },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const limit = Math.min(MAX_EMAILS, Math.max(1, Math.round(Number(args.limit) || DEFAULT_EMAILS)))
    let q = ctx.supabase.from('communications').select(EMAIL_COLUMNS).eq('tenant_id', ctx.tenantId).eq('type', 'email')
    let heading: string
    let jobNumber: string | null = null

    if (typeof args.job_number === 'string' && args.job_number.trim()) {
      const job = await jobFromArgs(args, ctx)
      if (isToolResult(job)) return job
      q = q.eq('job_id', job.id)
      jobNumber = job.job_number
      heading = `${job.job_number}, ${job.property_address ?? 'no address'} — latest emails:`
    } else {
      const since = new Date(Date.now() - UNLINKED_DAYS * 24 * 60 * 60 * 1000).toISOString()
      q = q.is('job_id', null).eq('direction', 'inbound').gte('created_at', since)
      heading = `Incoming emails not on a job (last ${UNLINKED_DAYS} days):`
    }

    const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
    if (error) throw error
    const emails = (data ?? []) as EmailRow[]
    if (!emails.length) {
      return { text: jobNumber ? `No emails on ${jobNumber} yet.` : `No unlinked incoming emails in the last ${UNLINKED_DAYS} days.`, data: { emails: [] } }
    }
    return {
      text: [heading, ...emails.map(describe)].join('\n'),
      data: { job_number: jobNumber, emails: emails.map(emailSummary) },
    }
  },
}

export const getEmail: McpTool = {
  name: 'get_email',
  title: 'Read email',
  description: 'Reads one email in full (from list_job_emails): who it\'s from and to, subject, date, attachments and the whole text.',
  inputSchema: {
    type: 'object',
    properties: { email_id: { type: 'string', description: 'email_id from list_job_emails.' } },
    required: ['email_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const id = typeof args.email_id === 'string' ? args.email_id.trim() : ''
    if (!UUID_RE.test(id)) return { text: 'Email not found — use list_job_emails for its id.', isError: true }
    const { data, error } = await ctx.supabase
      .from('communications').select(EMAIL_COLUMNS).eq('tenant_id', ctx.tenantId).eq('id', id).eq('type', 'email').maybeSingle()
    if (error) throw error
    if (!data) return { text: 'Email not found — use list_job_emails for its id.', isError: true }
    const e = data as EmailRow
    const body = bodyOf(e)
    const files = attachmentNames(e.attachments)
    return {
      text: [
        `From: ${e.from_email ?? 'unknown'}. To: ${e.to_email ?? 'unknown'}.${e.created_at ? ` ${spokenDate(e.created_at)}.` : ''}`,
        `Subject: ${e.subject ?? '(no subject)'}`,
        ...(files.length ? [`Attachments: ${files.join(', ')}.`] : []),
        '',
        body.length > FULL_BODY_CHARS ? `${body.slice(0, FULL_BODY_CHARS)}… (cut short)` : body || '(no text)',
      ].join('\n'),
      data: { ...emailSummary(e), body: body.slice(0, FULL_BODY_CHARS) },
    }
  },
}

export const replyToEmailTool: McpTool = {
  name: 'reply_to_email',
  title: 'Reply to email',
  description: [
    'Replies to an incoming email in the same conversation, to whoever sent it, from the office address — like the Reply box in the app — and records it on the job.',
    'Write the reply as plain text in the user\'s words (a short greeting and sign-off are fine; don\'t add commitments they didn\'t make).',
    'ONLY call this after reading back who it goes to and the full reply, and the user has clearly said yes.',
    'The same reply on the same conversation within 10 minutes is refused as a likely repeat unless send_anyway: true.',
    'If a call returns an error, tell the user what it says instead of retrying.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      email_id: { type: 'string', description: 'email_id of the incoming email, from list_job_emails.' },
      body: { type: 'string', description: 'The reply text.' },
      send_anyway: { type: 'boolean', description: 'The user confirmed sending the same reply again.' },
    },
    required: ['email_id', 'body'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },

  async run(args, ctx): Promise<McpToolResult> {
    const id = typeof args.email_id === 'string' ? args.email_id.trim() : ''
    const body = typeof args.body === 'string' ? args.body.trim() : ''
    if (!UUID_RE.test(id)) return { text: 'Email not found — use list_job_emails for its id.', isError: true }
    if (!body) return { text: 'What should the reply say?', isError: true }

    const { data: source, error } = await ctx.supabase
      .from('communications').select(EMAIL_COLUMNS).eq('tenant_id', ctx.tenantId).eq('id', id).eq('type', 'email').maybeSingle()
    if (error) throw error
    if (!source) return { text: 'Email not found — use list_job_emails for its id.', isError: true }
    const e = source as EmailRow
    if (e.direction !== 'inbound') {
      return { text: 'That\'s an email we sent — choose the incoming email to reply to.', isError: true }
    }

    if (args.send_anyway !== true && (e.thread_id || e.job_id)) {
      const since = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000).toISOString()
      let recent = ctx.supabase.from('communications').select('created_at, content')
        .eq('tenant_id', ctx.tenantId).eq('type', 'email').eq('direction', 'outbound').gte('created_at', since)
      recent = e.thread_id ? recent.eq('thread_id', e.thread_id) : recent.eq('job_id', e.job_id as string)
      const { data: sent, error: sentErr } = await recent
      if (sentErr) throw sentErr
      if ((sent ?? []).some(s => (s.content ?? '').trim() === body)) {
        return {
          text: `Not sent: that same reply went on this conversation in the last ${DUPLICATE_WINDOW_MINUTES} minutes. Ask the user if they really want it sent again; if so, call again with send_anyway: true.`,
          isError: true,
        }
      }
    }

    try {
      const result = await replyToEmail(ctx.supabase, ctx.tenantId, id, body)
      return { text: `Replied to ${result.to}: "${result.subject}".`, data: { to: result.to, subject: result.subject } }
    } catch (err) {
      if (err instanceof ReplyError) return { text: err.message, data: { status: err.status }, isError: true }
      throw err
    }
  },
}
