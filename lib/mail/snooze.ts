import { getGmailClient } from '@/lib/gmail/client'
import { applyThreadAction } from './actions'
import { ComposeError } from './compose'
import { MIN_SCHEDULE_LEAD_MS } from './schedule-rules'
import { fetchThreads, mailDb, type Mailbox } from './sync'

// Snooze (see migration 20261106_mail_irc.sql): Gmail has no snooze through
// the API, so a snoozed conversation is archived in Gmail and comes back to
// the inbox, unread, at the chosen time (wakeSnoozed, run by the
// scheduled-send cron every minute). A new message wakes it early, as in Gmail.

export type Snooze = { id: string; gmail_thread_id: string; until: string; subject: string | null }

const COLUMNS = 'id, gmail_thread_id, until, subject'

export async function snoozeThreads(mailbox: Mailbox, userId: string | null, threadIds: string[], until: string, db = mailDb()): Promise<{ done: string[]; failed: string[] }> {
  const at = new Date(until)
  if (Number.isNaN(at.getTime())) throw new ComposeError('That time isn\'t a valid date')
  if (at.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS - 5_000) throw new ComposeError('Choose a time at least a minute from now')

  const result = await applyThreadAction(mailbox, threadIds, 'archive', db)
  if (!result.done.length) return result

  const { data: threads } = await db.from('mail_threads').select('gmail_thread_id, subject')
    .eq('mailbox_id', mailbox.id).in('gmail_thread_id', result.done)
  const subjects = new Map(((threads as { gmail_thread_id: string; subject: string | null }[] | null) ?? []).map(t => [t.gmail_thread_id, t.subject]))

  const now = new Date().toISOString()
  // Snoozing again moves the time
  await db.from('mail_snoozes').update({ status: 'cancelled', updated_at: now })
    .eq('mailbox_id', mailbox.id).in('gmail_thread_id', result.done).eq('status', 'snoozed')
  const { error } = await db.from('mail_snoozes').insert(result.done.map(id => ({
    tenant_id: mailbox.tenant_id,
    mailbox_id: mailbox.id,
    gmail_thread_id: id,
    until: at.toISOString(),
    subject: subjects.get(id) ?? null,
    created_by: userId,
  })))
  if (error) throw new ComposeError(`Could not snooze: ${error.message}`)
  return result
}

/** Back to the inbox now */
export async function unsnooze(mailbox: Mailbox, id: string, db = mailDb()): Promise<boolean> {
  const { data } = await db.from('mail_snoozes')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('mailbox_id', mailbox.id).eq('id', id).eq('status', 'snoozed')
    .select('gmail_thread_id').maybeSingle()
  const threadId = (data as { gmail_thread_id: string } | null)?.gmail_thread_id
  if (!threadId) return false
  await applyThreadAction(mailbox, [threadId], 'inbox', db)
  return true
}

export async function listSnoozed(mailbox: Mailbox, db = mailDb()): Promise<Snooze[]> {
  const { data, error } = await db.from('mail_snoozes').select(COLUMNS)
    .eq('mailbox_id', mailbox.id).eq('status', 'snoozed').order('until', { ascending: true })
  if (error) throw new Error(error.message)
  return (data as Snooze[] | null) ?? []
}

/** Brings back snoozed conversations that are due, or that a new message already brought back */
export async function wakeSnoozed(db = mailDb(), now = new Date()): Promise<{ woken: number }> {
  const { data: live } = await db.from('mail_snoozes')
    .select('id, mailbox_id, gmail_thread_id, until').eq('status', 'snoozed')
  const rows = (live as { id: string; mailbox_id: string; gmail_thread_id: string; until: string }[] | null) ?? []
  if (!rows.length) return { woken: 0 }

  // A reply arrived meanwhile: it's in the inbox already
  const { data: inInbox } = await db.from('mail_threads').select('mailbox_id, gmail_thread_id')
    .in('gmail_thread_id', rows.map(r => r.gmail_thread_id)).contains('label_ids', ['INBOX'])
  const back = new Set(((inInbox as { mailbox_id: string; gmail_thread_id: string }[] | null) ?? []).map(t => `${t.mailbox_id}:${t.gmail_thread_id}`))

  let woken = 0
  const mailboxes = new Map<string, Mailbox>()
  for (const r of rows) {
    const arrived = back.has(`${r.mailbox_id}:${r.gmail_thread_id}`)
    if (!arrived && new Date(r.until) > now) continue
    // Claim it, so overlapping runs don't both act
    const { data: claimed } = await db.from('mail_snoozes')
      .update({ status: 'woken', updated_at: now.toISOString() })
      .eq('id', r.id).eq('status', 'snoozed').select('id').maybeSingle()
    if (!claimed) continue
    woken++
    if (arrived) continue
    try {
      await getGmailClient().users.threads.modify({ userId: 'me', id: r.gmail_thread_id, requestBody: { addLabelIds: ['INBOX', 'UNREAD'] } })
      if (!mailboxes.has(r.mailbox_id)) {
        const { data: mb } = await db.from('mailboxes').select('*').eq('id', r.mailbox_id).single()
        mailboxes.set(r.mailbox_id, mb as Mailbox)
      }
      await fetchThreads(mailboxes.get(r.mailbox_id)!, [r.gmail_thread_id], db)
    } catch (err) {
      console.error(`[snooze] could not bring back thread ${r.gmail_thread_id}:`, err)
      // Try again next minute
      await db.from('mail_snoozes').update({ status: 'snoozed' }).eq('id', r.id)
      woken--
    }
  }
  return { woken }
}
