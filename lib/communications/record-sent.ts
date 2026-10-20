import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExtractedMessage } from '@/lib/gmail/messages'
import { matchJob } from './match-job'
import { findThreadJobId, linkThreadToJob } from './thread-link'

// How far apart an app-sent reply's DB row and its Gmail SENT copy can be
const APP_REPLY_DEDUP_WINDOW_MS = 10 * 60 * 1000

export type RecordSentResult = 'recorded' | 'skipped_internal' | 'duplicate_app_reply'

function recipientEmails(header: string): string[] {
  return (header.match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []).map(e => e.toLowerCase())
}

/**
 * Records an email sent from the office mailbox directly in Gmail (not via the app)
 * as an outbound communication, linked to a job when possible.
 *
 * This anchors the Gmail thread: when a trade replies to a quote request sent
 * from Gmail, the reply inherits the job via the thread instead of landing in
 * the unlinked inbox.
 */
export async function recordSentMessage(params: {
  db: SupabaseClient
  tenantId: string
  msg: ExtractedMessage
  ownDomain: string
}): Promise<RecordSentResult> {
  const { db, tenantId, msg, ownDomain } = params

  const external = recipientEmails(msg.to).filter(e => !e.endsWith(`@${ownDomain}`))
  if (external.length === 0) return 'skipped_internal'

  // Replies sent through the app already wrote their own outbound row
  if (msg.threadId) {
    const since = new Date(new Date(msg.receivedAt).getTime() - APP_REPLY_DEDUP_WINDOW_MS).toISOString()
    const { count } = await db
      .from('communications')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('thread_id', msg.threadId)
      .eq('direction', 'outbound')
      .eq('source', 'manual_reply')
      .eq('subject', msg.subject)
      .gte('created_at', since)
    if ((count ?? 0) > 0) return 'duplicate_app_reply'
  }

  let jobId = await findThreadJobId(db, tenantId, msg.threadId)
  if (!jobId) {
    try {
      const match = await matchJob({
        subject: msg.subject,
        body: msg.bodyText,
        from_email: msg.fromEmail,
        tenant_id: tenantId,
      })
      if (match.job_id && match.confidence === 'high') jobId = match.job_id
    } catch (err) {
      console.error('[record-sent] matchJob error:', err)
    }
  }

  const { error } = await db.from('communications').insert({
    tenant_id: tenantId,
    job_id: jobId,
    type: 'email',
    direction: 'outbound',
    subject: msg.subject,
    content: msg.bodyText,
    created_at: msg.receivedAt,
    thread_id: msg.threadId || null,
    from_email: msg.fromEmail,
    to_email: msg.to,
    body_text: msg.bodyText,
    gmail_message_id: msg.gmailMessageId || null,
    source: 'gmail_sent',
  })
  if (error) {
    console.error('[record-sent] insert error:', error)
    throw new Error(`Failed to record sent message: ${error.message}`)
  }

  // Pull any earlier unlinked replies in this thread onto the job
  if (jobId) await linkThreadToJob(db, tenantId, msg.threadId, jobId)

  return 'recorded'
}
