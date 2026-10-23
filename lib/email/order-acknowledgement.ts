import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { getGmailClient } from '@/lib/gmail/client'
import { documentTemplateVars, renderTemplate, resolveEmailTemplate } from './templates'
import { renderRichTemplate } from './rich-text'
import { composeStandardEmail } from './compose'
import { ensureAngleBrackets } from './build-raw'
import { isValidEmail, sendEmailViaGmail } from '@/lib/signing/email/gmail'

// The automatic reply to whoever sent an insurer order, sent when the order
// is lodged as a new job (lib/insurer-orders/lodge). It replies in the order
// email's Gmail thread using the 'order_acknowledgement' template
// (Settings → Email Templates), and is recorded on the job's comms log.

const FALLBACK_FROM = 'office@insurancerepairco.com.au'
const NO_REPLY = /no-?reply|do-?not-?reply/i

export interface OrderAcknowledgementResult {
  sent: boolean
  to?: string
  /** Why it wasn't sent, in words the office can act on */
  skipped?: string
}

/**
 * Never throws: lodging has already succeeded by the time this runs, so a
 * failure is reported in the result instead.
 */
export async function sendOrderAcknowledgement(
  supabase: SupabaseClient<Database>,
  params: { tenantId: string; orderId: string; jobId: string },
): Promise<OrderAcknowledgementResult> {
  const { tenantId, orderId, jobId } = params
  try {
    const [{ data: order }, { data: job }, { data: tenant }, { data: orderComms }] = await Promise.all([
      supabase.from('insurer_orders').select('order_sender_email, order_sender_name, raw_email_subject').eq('id', orderId).single(),
      supabase.from('jobs').select('*').eq('id', jobId).single(),
      supabase.from('tenants').select('*').eq('id', tenantId).single(),
      supabase.from('communications').select('thread_id, gmail_message_id, subject')
        .eq('tenant_id', tenantId).eq('insurer_order_id', orderId).eq('direction', 'inbound')
        .order('created_at', { ascending: true }).limit(1),
    ])
    if (!order || !job || !tenant) return { sent: false, skipped: 'Order or job not found' }

    const to = order.order_sender_email?.trim()
    const from = tenant.contact_email?.trim() || FALLBACK_FROM
    if (!isValidEmail(to)) return { sent: false, skipped: 'The order has no sender email address' }
    if (NO_REPLY.test(to)) return { sent: false, skipped: `The order came from a no-reply address (${to})` }
    if (to.toLowerCase() === from.toLowerCase()) return { sent: false, skipped: 'The order was sent from your own address' }

    const orderComm = orderComms?.[0] ?? null
    const threadId = orderComm?.thread_id ?? null
    const messageId = orderComm?.gmail_message_id || await firstMessageIdInThread(threadId)

    const template = await resolveEmailTemplate(supabase, tenantId, 'order_acknowledgement', job.client_id)
    const vars = {
      ...documentTemplateVars({ job, tenant, contactName: order.order_sender_name?.trim().split(/\s+/)[0] || null }),
      order_subject: orderComm?.subject || order.raw_email_subject || '',
    }
    const subject = renderTemplate(template.subject, vars).replace(/^(re:\s*)+/i, 'Re: ').trim()
    const fallbackSubject = `Order received – ${[job.property_address, job.claim_number && `Claim ${job.claim_number}`].filter(Boolean).join(' – ')}`
    const finalSubject = !subject || /^re:$/i.test(subject) ? fallbackSubject : subject
    const { html, text } = composeStandardEmail(renderRichTemplate(template.body, vars), tenant)

    const sent = await sendEmailViaGmail(supabase, {
      from,
      fromName: tenant.trading_name || tenant.name,
      to,
      subject: finalSubject,
      text,
      html,
      inReplyTo: messageId ? ensureAngleBrackets(messageId) : undefined,
      threadId,
    })

    const { error } = await supabase.from('communications').insert({
      tenant_id: tenantId,
      job_id: jobId,
      type: 'email',
      direction: 'outbound',
      contact_name: order.order_sender_name,
      contact_detail: to,
      subject: finalSubject,
      content: text,
      body_text: text,
      from_email: from,
      to_email: to,
      thread_id: sent.threadId ?? threadId,
      gmail_message_id: sent.gmailId,
      source: 'order_acknowledgement',
    })
    if (error) console.error(`[order-ack] communications insert failed for job ${jobId}:`, error)

    return { sent: true, to }
  } catch (err) {
    console.error(`[order-ack] send failed for order ${orderId}:`, err)
    return { sent: false, skipped: 'The email could not be sent' }
  }
}

// Order emails recorded before gmail_message_id was stored on them: read the
// Message-ID of the thread's first message so the reply threads for the sender.
async function firstMessageIdInThread(threadId: string | null): Promise<string | null> {
  if (!threadId) return null
  try {
    const res = await getGmailClient().users.threads.get({
      userId: 'me', id: threadId, format: 'metadata', metadataHeaders: ['Message-ID'],
    })
    const headers = res.data.messages?.[0]?.payload?.headers ?? []
    return headers.find(h => h.name?.toLowerCase() === 'message-id')?.value ?? null
  } catch (err) {
    console.error(`[order-ack] thread ${threadId} lookup failed:`, err)
    return null
  }
}
