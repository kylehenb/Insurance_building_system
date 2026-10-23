import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/server'
import { getGmailClient } from '@/lib/gmail/client'
import { buildEmailRaw, ensureAngleBrackets } from '@/lib/email/build-raw'

// Replying to an email on the job's comms log: sends in the same Gmail thread
// (Re: subject, In-Reply-To/References) to whoever sent it, and records the
// reply. Used by the Reply box (app/api/communications/reply) and the voice
// connector.

const FALLBACK_FROM = 'office@insurancerepairco.com.au'

interface CommRow {
  job_id: string | null
  thread_id: string | null
  from_email: string | null
  subject: string | null
  gmail_message_id: string | null
}

export class ReplyError extends Error {
  constructor(message: string, public readonly status: 404 | 422 | 502) {
    super(message)
    this.name = 'ReplyError'
  }
}

export interface ReplyResult {
  to: string
  subject: string
  jobId: string | null
}

/**
 * Sends body as a reply to the email commId. supabase reads the source email
 * (the signed-in user's client, or the service client for automations);
 * tenantId is always enforced.
 */
export async function replyToEmail(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  commId: string,
  body: string,
): Promise<ReplyResult> {
  const { data: comm, error: commErr } = await supabase
    .from('communications')
    .select('job_id,thread_id,from_email,subject,gmail_message_id')
    .eq('id', commId)
    .eq('tenant_id', tenantId)
    .eq('type', 'email')
    .single()

  if (commErr || !comm) throw new ReplyError('Communication not found', 404)

  const source = comm as CommRow

  if (!source.from_email) {
    throw new ReplyError('Source email has no from_email — cannot reply', 422)
  }

  // Resolve tenant From address
  const serviceClient = createServiceClient()
  const { data: tenant } = await serviceClient
    .from('tenants')
    .select('contact_email, name, trading_name')
    .eq('id', tenantId)
    .single()

  const sender = tenant as { contact_email: string | null; name: string | null; trading_name: string | null } | null
  const fromEmail = sender?.contact_email ?? FALLBACK_FROM

  // Build Re: subject (avoid double-prefix)
  const originalSubject = source.subject ?? ''
  const replySubject = originalSubject.toLowerCase().startsWith('re:')
    ? originalSubject
    : `Re: ${originalSubject}`

  // Build RFC 2822 threading headers from gmail_message_id
  const msgId = source.gmail_message_id
  const inReplyTo = msgId ? ensureAngleBrackets(msgId) : undefined
  const references = inReplyTo ?? undefined

  const raw = buildEmailRaw({
    from: fromEmail,
    fromName: sender?.trading_name || sender?.name,
    to: source.from_email,
    subject: replySubject,
    body,
    inReplyTo,
    references,
  })

  // Send via Gmail — threadId appends to the existing conversation
  let sentGmailId: string | null = null
  try {
    const gmail = getGmailClient()
    const sendRes = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw,
        ...(source.thread_id ? { threadId: source.thread_id } : {}),
      },
    })
    sentGmailId = sendRes.data.id ?? null
  } catch (err) {
    console.error('[reply] Gmail send error:', err)
    throw new ReplyError('Failed to send email', 502)
  }

  // Mark the sent copy as processed so the Gmail SENT watch doesn't record it twice
  if (sentGmailId) {
    await serviceClient
      .from('processed_gmail_messages' as never)
      .upsert(
        { message_id: sentGmailId, processed_at: new Date().toISOString() } as never,
        { onConflict: 'message_id', ignoreDuplicates: true }
      )
  }

  // Record outbound communication
  const { error: insertErr } = await serviceClient.from('communications').insert({
    tenant_id: tenantId,
    job_id: source.job_id,
    type: 'email',
    direction: 'outbound',
    subject: replySubject,
    content: body,
    from_email: fromEmail,
    to_email: source.from_email,
    thread_id: source.thread_id,
    source: 'manual_reply',
  })

  if (insertErr) {
    console.error('[reply] insert error:', insertErr)
    // Don't fail the request — email already sent
  }

  return { to: source.from_email, subject: replySubject, jobId: source.job_id }
}
