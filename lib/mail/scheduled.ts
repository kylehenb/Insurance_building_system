import { recordActivity } from '@/lib/activity/log'
import { getGmailClient } from '@/lib/gmail/client'
import { ComposeError, describeDraft, sendDraft } from './compose'
import { MIN_SCHEDULE_LEAD_MS, spokenSendAt } from './schedule-rules'
import { mailDb, type Mailbox } from './sync'

// Scheduled send (see migration 20261105_scheduled_emails.sql). The email
// waits as a Gmail draft; sendDueEmails (cron, every minute) sends it with
// the same sendDraft as the Send button.

export type ScheduledEmail = {
  id: string
  gmail_draft_id: string
  thread_id: string | null
  send_at: string
  status: 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled'
  subject: string | null
  recipients: string | null
  error: string | null
}

const COLUMNS = 'id, gmail_draft_id, thread_id, send_at, status, subject, recipients, error'

/** A 'sending' row older than this was interrupted (e.g. the function timed out) */
const STUCK_MS = 10 * 60_000
const DUE_BATCH = 20

/** Schedules a saved draft (or moves its existing schedule) */
export async function scheduleDraft(
  mailbox: Mailbox,
  userId: string | null,
  draftId: string,
  sendAt: string,
  db = mailDb(),
): Promise<ScheduledEmail> {
  const at = new Date(sendAt)
  if (Number.isNaN(at.getTime())) throw new ComposeError('That send time isn\'t a valid date')
  if (at.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS - 5_000) throw new ComposeError('Choose a time at least a minute from now')

  const { to, subject, exists } = await describeDraft(draftId)
  if (!exists) throw new ComposeError('This draft no longer exists — it may have been sent or deleted', 404)

  const { data: live } = await db
    .from('scheduled_emails')
    .select('id, status')
    .eq('mailbox_id', mailbox.id)
    .eq('gmail_draft_id', draftId)
    .in('status', ['scheduled', 'sending'])
    .maybeSingle()
  if ((live as { status: string } | null)?.status === 'sending') throw new ComposeError('This email is being sent right now')

  const fields = { send_at: at.toISOString(), subject, recipients: to, error: null, updated_at: new Date().toISOString() }
  const { data, error } = live
    ? await db.from('scheduled_emails').update(fields).eq('id', (live as { id: string }).id).select(COLUMNS).single()
    : await db.from('scheduled_emails').insert({
        ...fields,
        tenant_id: mailbox.tenant_id,
        mailbox_id: mailbox.id,
        gmail_draft_id: draftId,
        thread_id: await draftThreadId(draftId),
        created_by: userId,
      }).select(COLUMNS).single()
  if (error || !data) throw new ComposeError(`Could not schedule the email: ${error?.message}`, 502)
  return data as ScheduledEmail
}

async function draftThreadId(draftId: string): Promise<string | null> {
  try {
    return (await getGmailClient().users.drafts.get({ userId: 'me', id: draftId, format: 'minimal' })).data.message?.threadId ?? null
  } catch {
    return null
  }
}

/** Takes an email off the schedule; it stays a draft. Null if it wasn't scheduled. */
export async function cancelScheduled(mailbox: Mailbox, id: string, db = mailDb()): Promise<ScheduledEmail | null> {
  const { data } = await db
    .from('scheduled_emails')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('mailbox_id', mailbox.id)
    .eq('id', id)
    .in('status', ['scheduled', 'failed'])
    .select(COLUMNS)
    .maybeSingle()
  return (data as ScheduledEmail | null) ?? null
}

/** The Scheduled list: waiting, being sent, and failed ones to deal with */
export async function listScheduled(mailbox: Mailbox, db = mailDb()): Promise<ScheduledEmail[]> {
  const { data, error } = await db
    .from('scheduled_emails')
    .select(COLUMNS)
    .eq('mailbox_id', mailbox.id)
    .in('status', ['scheduled', 'sending', 'failed'])
    .order('send_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data as ScheduledEmail[] | null) ?? []
}

/** Gmail thread id → when it's scheduled to send, for the "Scheduled" chips in lists */
export async function scheduledThreads(mailbox: Mailbox, db = mailDb()): Promise<Record<string, string>> {
  const { data } = await db
    .from('scheduled_emails')
    .select('thread_id, send_at')
    .eq('mailbox_id', mailbox.id)
    .eq('status', 'scheduled')
  const out: Record<string, string> = {}
  for (const r of (data as { thread_id: string | null; send_at: string }[] | null) ?? []) {
    if (r.thread_id) out[r.thread_id] = r.send_at
  }
  return out
}

/** Sends every scheduled email that's due. Returns how many went and failed. */
export async function sendDueEmails(db = mailDb(), now = new Date()): Promise<{ sent: number; failed: number }> {
  // Interrupted sends: Gmail may or may not have sent them — say so rather than send twice
  await db
    .from('scheduled_emails')
    .update({ status: 'failed', error: 'Sending was interrupted — check Sent before sending it again', updated_at: now.toISOString() })
    .eq('status', 'sending')
    .lt('updated_at', new Date(now.getTime() - STUCK_MS).toISOString())

  const { data: due } = await db
    .from('scheduled_emails')
    .select(`${COLUMNS}, mailbox_id, tenant_id, created_by`)
    .eq('status', 'scheduled')
    .lte('send_at', now.toISOString())
    .order('send_at', { ascending: true })
    .limit(DUE_BATCH)

  let sent = 0
  let failed = 0
  for (const row of (due as (ScheduledEmail & { mailbox_id: string; tenant_id: string; created_by: string | null })[] | null) ?? []) {
    // Claim it, so overlapping runs can't both send it
    const { data: claimed } = await db
      .from('scheduled_emails')
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    const { data: mailbox } = await db.from('mailboxes').select('*').eq('id', row.mailbox_id).single()
    try {
      const result = await sendDraft(mailbox as Mailbox, row.gmail_draft_id, db)
      await db.from('scheduled_emails')
        .update({ status: 'sent', sent_message_id: result.messageId, thread_id: result.threadId ?? row.thread_id, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      await recordActivity({
        tenantId: row.tenant_id,
        userId: row.created_by,
        action: 'mail.send',
        summary: `Sent the scheduled email "${row.subject ?? '(no subject)'}" to ${row.recipients ?? 'unknown recipients'} (scheduled for ${spokenSendAt(row.send_at)})`,
        via: 'app',
      })
      sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[scheduled-send] ${row.id} failed:`, err)
      await db.from('scheduled_emails')
        .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      await recordActivity({
        tenantId: row.tenant_id,
        userId: row.created_by,
        action: 'mail.send',
        summary: `The scheduled email "${row.subject ?? '(no subject)'}" to ${row.recipients ?? 'unknown recipients'} wasn't sent`,
        via: 'app',
        outcome: 'failed',
        detail: message,
      })
      failed++
    }
  }
  return { sent, failed }
}
