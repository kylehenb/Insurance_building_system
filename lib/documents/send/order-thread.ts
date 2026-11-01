import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { getGmailClient } from '@/lib/gmail/client'
import { ensureAngleBrackets } from '@/lib/email/build-raw'
import { replySubject } from '@/lib/mail/compose-rules'
import { replyQuote } from '@/lib/mail/compose'

// The Gmail conversation the insurer's order came in on, so documents sent
// back to the insurer (the inspection package: report, quote, invoice) go as
// a reply in it rather than as a new email. The order email is the job's
// earliest inbound email tied to an insurer order. Its Message-ID often isn't
// stored, so the headers are read from the Gmail thread itself. When sending,
// the message replied to is quoted underneath, as Reply in Gmail does.

export interface OrderThread {
  /** Gmail thread to add the sent message to */
  threadId: string
  /** RFC 822 Message-ID of the latest message in the thread (what we reply to) */
  inReplyTo: string | null
  /** The thread's Message-IDs, oldest first, for the References header */
  references: string | null
  /** "Re: <order email subject>". Gmail only keeps a reply in the thread when the subject matches. */
  subject: string
  /** The message replied to, quoted (only when asked for: withQuote) */
  quote: { html: string; text: string } | null
}

type Db = SupabaseClient<Database>

/** The order email's thread id and subject, from the comms log. */
async function orderEmail(db: Db, tenantId: string, jobId: string): Promise<{ threadId: string; subject: string | null } | null> {
  const pick = (rows: { thread_id: string | null; subject: string | null }[] | null) => {
    const row = (rows ?? []).find(r => r.thread_id)
    return row ? { threadId: row.thread_id as string, subject: row.subject } : null
  }

  // The order email filed on the job
  const { data: onJob } = await db.from('communications').select('thread_id, subject')
    .eq('tenant_id', tenantId).eq('job_id', jobId).eq('direction', 'inbound')
    .not('insurer_order_id', 'is', null).not('thread_id', 'is', null)
    .order('created_at', { ascending: true }).limit(1)
  const found = pick(onJob)
  if (found) return found

  // Or the email of an order lodged as this job, wherever it was filed
  const { data: orders } = await db.from('insurer_orders').select('id, raw_email_subject')
    .eq('tenant_id', tenantId).eq('job_id', jobId).order('created_at', { ascending: true })
  if (!orders?.length) return null
  const { data: byOrder } = await db.from('communications').select('thread_id, subject')
    .eq('tenant_id', tenantId).eq('direction', 'inbound').in('insurer_order_id', orders.map(o => o.id))
    .not('thread_id', 'is', null).order('created_at', { ascending: true }).limit(1)
  const viaOrder = pick(byOrder)
  return viaOrder ? { ...viaOrder, subject: viaOrder.subject || orders[0].raw_email_subject } : null
}

/**
 * The job's insurer order thread, ready to reply in; null when the job has
 * no order email (entered by hand, or the email was never recorded).
 * Never throws: without it the email simply goes as a new one.
 */
export async function findOrderThread(
  db: Db,
  tenantId: string,
  jobId: string,
  options: { withQuote?: boolean } = {},
): Promise<OrderThread | null> {
  try {
    const email = await orderEmail(db, tenantId, jobId)
    if (!email) return null

    let ids: string[] = []
    let gmailSubject: string | null = null
    try {
      const res = await getGmailClient().users.threads.get({
        userId: 'me', id: email.threadId, format: 'metadata', metadataHeaders: ['Message-ID', 'Subject'],
      })
      const messages = (res?.data?.messages ?? []).filter(m => !(m.labelIds ?? []).includes('DRAFT'))
      const header = (m: (typeof messages)[number], name: string) =>
        m.payload?.headers?.find(h => h.name?.toLowerCase() === name)?.value?.trim() || null
      ids = messages.map(m => header(m, 'message-id')).filter((id): id is string => !!id).map(ensureAngleBrackets)
      gmailSubject = messages[0] ? header(messages[0], 'subject') : null
    } catch (err) {
      // Still joins the thread in our mailbox; only the insurer's side may not thread it
      console.error(`[order-thread] Gmail thread ${email.threadId} lookup failed:`, err)
    }

    const original = (gmailSubject || email.subject || '').trim()
    if (!original) return null
    const inReplyTo = ids.length ? ids[ids.length - 1] : null

    let quote: OrderThread['quote'] = null
    if (options.withQuote && inReplyTo) {
      try {
        const q = await replyQuote(email.threadId, inReplyTo)
        if (q && (q.html || q.text)) quote = { html: q.html, text: q.text }
      } catch (err) {
        // Sent without the quote: still a reply in the thread
        console.error(`[order-thread] quote for thread ${email.threadId} failed:`, err)
      }
    }
    return {
      quote,
      threadId: email.threadId,
      inReplyTo,
      // Keep the header a sensible length on long threads: the first and the latest few
      references: ids.length ? [...new Set([ids[0], ...ids.slice(-9)])].join(' ') : null,
      subject: replySubject(original),
    }
  } catch (err) {
    console.error(`[order-thread] lookup failed for job ${jobId}:`, err)
    return null
  }
}
