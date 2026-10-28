import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/server'
import { getGmailClient } from '@/lib/gmail/client'
import { buildEmailRaw, ensureAngleBrackets, type EmailAttachment } from '@/lib/email/build-raw'
import { composeEmailBody } from '@/lib/email/rich-text'
import { emailSignatureFor, type SignatureTenant } from '@/lib/email/signature'
import { renderStandardEmailHtml, STANDARD_EMAIL_FONT_SIZE } from '@/lib/email/email-html'
import { replyQuote } from '@/lib/mail/compose'
import { quoteHtml, quoteText, type QuotedEmail } from '@/lib/mail/compose-rules'

// Replying to an email on the job's comms log: sends in the same Gmail thread
// (Re: subject, In-Reply-To/References) to whoever sent it, and records the
// reply. It reads as a reply from Gmail does: the text, the company signature,
// then the email quoted underneath with the conversation before it. Used by
// the Reply box (app/api/communications/reply) and the voice connector.

const FALLBACK_FROM = 'office@insurancerepairco.com.au'

interface CommRow {
  job_id: string | null
  thread_id: string | null
  from_email: string | null
  subject: string | null
  gmail_message_id: string | null
  created_at: string | null
  body_text: string | null
  content: string | null
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
 * tenantId is always enforced. attachments go with it (the voice connector's
 * job photos and files).
 */
export async function replyToEmail(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  commId: string,
  body: string,
  attachments: EmailAttachment[] = [],
): Promise<ReplyResult> {
  const { data: comm, error: commErr } = await supabase
    .from('communications')
    .select('job_id,thread_id,from_email,subject,gmail_message_id,created_at,body_text,content')
    .eq('id', commId)
    .eq('tenant_id', tenantId)
    .eq('type', 'email')
    .single()

  if (commErr || !comm) throw new ReplyError('Communication not found', 404)

  const source = comm as CommRow

  if (!source.from_email) {
    throw new ReplyError('Source email has no from_email — cannot reply', 422)
  }

  // Resolve tenant From address and signature
  const serviceClient = createServiceClient()
  const { data: tenant } = await serviceClient
    .from('tenants')
    .select('contact_email, name, trading_name, email_signature, email_signature_image_path, email_signature_image_width, email_signature_image_height')
    .eq('id', tenantId)
    .single()

  const sender = tenant as (SignatureTenant & { contact_email: string | null }) | null
  const fromEmail = sender?.contact_email ?? FALLBACK_FROM
  const companyName = sender?.trading_name || sender?.name || ''

  // Build Re: subject (avoid double-prefix)
  const originalSubject = source.subject ?? ''
  const replySubject = originalSubject.toLowerCase().startsWith('re:')
    ? originalSubject
    : `Re: ${originalSubject}`

  // The email quoted underneath, from Gmail with its References chain; if
  // Gmail no longer has it, from the comms log
  let quote: Awaited<ReturnType<typeof replyQuote>> = null
  try {
    quote = await replyQuote(source.thread_id, source.gmail_message_id)
  } catch (err) {
    console.error('[reply] Gmail quote lookup failed:', err)
  }
  if (!quote) {
    const original: QuotedEmail = {
      from: { name: '', email: source.from_email }, to: [], cc: [], subject: originalSubject,
      date: source.created_at, html: '', text: (source.body_text ?? source.content ?? '').trim(),
    }
    const msgId = source.gmail_message_id ? ensureAngleBrackets(source.gmail_message_id) : null
    quote = original.text
      ? { html: quoteHtml(original, 'reply'), text: quoteText(original, 'reply'), inReplyTo: msgId, references: msgId }
      : { html: '', text: '', inReplyTo: msgId, references: msgId }
  }

  // The typed text and signature, as the Mail page sends it
  const signature = sender ? emailSignatureFor(sender) : null
  const typed = composeEmailBody(body, { fontSize: STANDARD_EMAIL_FONT_SIZE, signature, signatureFallback: '', logo: signature?.image ?? null })

  const raw = buildEmailRaw({
    from: fromEmail,
    fromName: sender?.trading_name || sender?.name,
    to: source.from_email,
    subject: replySubject,
    body: [typed.text, quote.text].filter(Boolean).join('\n\n'),
    html: renderStandardEmailHtml({ bodyHtml: typed.html + (quote.html ? `<br>${quote.html}` : ''), title: companyName }),
    inReplyTo: quote.inReplyTo ?? undefined,
    references: quote.references ?? undefined,
    attachments: attachments.length ? attachments : undefined,
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
    ...(attachments.length ? { attachments: attachments.map(a => ({ filename: a.filename, mime_type: a.mimeType, size_bytes: a.content.length })) } : {}),
  })

  if (insertErr) {
    console.error('[reply] insert error:', insertErr)
    // Don't fail the request — email already sent
  }

  return { to: source.from_email, subject: replySubject, jobId: source.job_id }
}
