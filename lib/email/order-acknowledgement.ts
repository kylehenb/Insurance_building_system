import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { getGmailClient } from '@/lib/gmail/client'
import { documentTemplateVars, renderTemplate, resolveEmailTemplate } from './templates'
import { escapeHtml, renderRichTemplate, toRichHtml } from './rich-text'
import { composeStandardEmail } from './compose'
import { ensureAngleBrackets } from './build-raw'
import { isValidEmail, sendEmailViaGmail } from '@/lib/signing/email/gmail'
import { runOrderChecks } from '@/lib/insurer-orders/checks'

// The automatic reply to whoever sent an insurer order, sent when the order
// is lodged as a new job (lib/insurer-orders/lodge). It replies in the order
// email's Gmail thread using the 'order_acknowledgement' template
// (Settings → Email Templates), and is recorded on the job's comms log.
// The order's checks (lib/insurer-orders/checks.ts) can add a paragraph — e.g.
// asking for the insured's phone number — or hold it back. It isn't sent
// when someone in the office has already emailed the sender about the order.

const FALLBACK_FROM = 'office@insurancerepairco.com.au'
const NO_REPLY = /no-?reply|do-?not-?reply/i
const SIGN_OFF = /^(?:(?:kind|warm|best|many)\s+)?(?:regards|thanks|thank you|cheers)[,.!]?$/i

export interface OrderAcknowledgementResult {
  sent: boolean
  to?: string
  /** Why it wasn't sent, in words the office can act on */
  skipped?: string
  /** It wasn't sent because the office had already replied to the sender */
  alreadyReplied?: boolean
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
      supabase.from('insurer_orders').select('order_sender_email, order_sender_name, raw_email_subject, created_at, insured_phone, insured_name, property_address, insurer').eq('id', orderId).single(),
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

    const checks = runOrderChecks(order)
    const hold = checks.find(c => c.holdAcknowledgement)
    if (hold) return { sent: false, skipped: hold.holdAcknowledgement }

    const orderComm = orderComms?.[0] ?? null
    const threadId = orderComm?.thread_id ?? null
    const thread = await threadMessages(threadId)
    const replied = await earlierReply(supabase, {
      tenantId, thread, threadId, to, from, claimNumber: job.claim_number, since: order.created_at,
    })
    if (replied) return { sent: false, alreadyReplied: true, skipped: `The office already replied to ${to} about this order${replied}` }
    const messageId = orderComm?.gmail_message_id || thread[0]?.messageId || null

    const template = await resolveEmailTemplate(supabase, tenantId, 'order_acknowledgement', job.client_id)
    const vars = {
      ...documentTemplateVars({ job, tenant, contactName: order.order_sender_name?.trim().split(/\s+/)[0] || null }),
      order_subject: orderComm?.subject || order.raw_email_subject || '',
    }
    const subject = renderTemplate(template.subject, vars).replace(/^(re:\s*)+/i, 'Re: ').trim()
    const fallbackSubject = `Order received – ${[job.property_address, job.claim_number && `Claim ${job.claim_number}`].filter(Boolean).join(' – ')}`
    const finalSubject = !subject || /^re:$/i.test(subject) ? fallbackSubject : subject
    const body = withOrderLines(template.body, checks.flatMap(c => c.acknowledgementLine ? [c.acknowledgementLine] : []))
    const { html, text } = composeStandardEmail(renderRichTemplate(body, vars), tenant)

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

/**
 * Places the checks' paragraphs in the template: where {order_notes} is, or
 * else just above the sign-off ("Kind regards," / {signature}), so templates
 * written before the checks get them too.
 */
export function withOrderLines(body: string, lines: string[]): string {
  const html = toRichHtml(body)
  const added = lines.map(l => `<p>${escapeHtml(l)}</p><p></p>`).join('')
  // An {order_notes} paragraph, with the blank line after it when there's nothing to add
  const slot = /<p>\s*\{order_notes\}\s*<\/p>(\s*<p>\s*<\/p>)?/
  if (slot.test(html)) return html.replace(slot, added)
  if (!added) return html.replace(/\{order_notes\}/g, '')
  const signature = html.indexOf('{signature}')
  if (signature < 0) return `${html}<p></p>${added}`
  let at = html.lastIndexOf('<p', signature)
  // Step back over a sign-off paragraph just above the signature
  const before = html.slice(0, at).match(/<p>([^<]*)<\/p>\s*$/)
  if (before && SIGN_OFF.test(before[1].trim())) at -= before[0].length
  return html.slice(0, at) + added + html.slice(at)
}

type ThreadMessage = { messageId: string | null; sent: boolean; from: string; date: string | null }

// The order thread's messages, oldest first: for the Message-ID to reply to
// (order emails recorded before gmail_message_id was stored on them) and to
// see whether the office has already replied in it.
async function threadMessages(threadId: string | null): Promise<ThreadMessage[]> {
  if (!threadId) return []
  try {
    const res = await getGmailClient().users.threads.get({
      userId: 'me', id: threadId, format: 'metadata', metadataHeaders: ['Message-ID', 'From', 'Date'],
    })
    return (res?.data?.messages ?? []).map(m => {
      const headers = m.payload?.headers ?? []
      const header = (name: string) => headers.find(h => h.name?.toLowerCase() === name)?.value ?? null
      return {
        messageId: header('message-id'),
        sent: (m.labelIds ?? []).includes('SENT') && !(m.labelIds ?? []).includes('DRAFT'),
        from: header('from') ?? '',
        date: header('date'),
      }
    })
  } catch (err) {
    console.error(`[order-ack] thread ${threadId} lookup failed:`, err)
    return []
  }
}

/**
 * Whether the office has already emailed the order's sender about it: a reply
 * in the order thread (from the app or straight from Gmail), or an email to
 * the sender since the order came in that's in that thread or names the claim
 * number. Returns " on <date>" (or "") when it has, null when not.
 */
async function earlierReply(
  supabase: SupabaseClient<Database>,
  p: { tenantId: string; thread: ThreadMessage[]; threadId: string | null; to: string; from: string; claimNumber: string | null; since: string | null },
): Promise<string | null> {
  const own = p.from.toLowerCase()
  const inThread = p.thread.slice(1).find(m => m.sent || m.from.toLowerCase().includes(own))
  if (inThread) return inThread.date ? ` on ${shortDate(inThread.date)}` : ''

  let query = supabase.from('communications').select('created_at, thread_id, subject, body_text')
    .eq('tenant_id', p.tenantId).eq('direction', 'outbound').ilike('to_email', `%${p.to}%`)
  if (p.since) query = query.gte('created_at', p.since)
  const { data, error } = await query.order('created_at', { ascending: true }).limit(50)
  if (error) {
    console.error('[order-ack] earlier reply lookup failed:', error)
    return null
  }
  const claim = p.claimNumber?.trim().toLowerCase()
  const match = (data ?? []).find(c =>
    (p.threadId && c.thread_id === p.threadId) ||
    (!!claim && `${c.subject ?? ''} ${c.body_text ?? ''}`.toLowerCase().includes(claim)))
  if (!match) return null
  return match.created_at ? ` on ${shortDate(match.created_at)}` : ''
}

function shortDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-AU', { timeZone: 'Australia/Perth', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
