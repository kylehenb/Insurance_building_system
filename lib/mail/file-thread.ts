import { getGmailClient } from '@/lib/gmail/client'
import { recordInboxMessage } from '@/lib/communications/inbound-email'
import { linkThreadToJob, setThreadCategory, threadExists } from '@/lib/communications/thread-link'
import { refreshFiling, type Filing } from './filing'
import { mailDb, type Mailbox } from './sync'

// Filing a conversation from the Mail page: on a job, as admin, or back to
// "to file" — the unlinked inbox's own functions (lib/communications). A
// conversation the app never recorded (older mail) gets its latest incoming
// email recorded first, as the voice connector's save_email does.

export class FileThreadError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message)
    this.name = 'FileThreadError'
  }
}

/** Records the latest incoming email of a conversation the app has no emails from */
async function recordIfUnknown(mailbox: Mailbox, threadId: string, db = mailDb()): Promise<void> {
  if (await threadExists(db, mailbox.tenant_id, threadId)) return
  const thread = (await getGmailClient().users.threads.get({ userId: 'me', id: threadId, format: 'minimal' })).data
  const incoming = (thread.messages ?? []).filter(m => !(m.labelIds ?? []).some(l => l === 'SENT' || l === 'DRAFT'))
  const latest = incoming.at(-1)?.id
  if (!latest) throw new FileThreadError('There\'s no incoming email in this conversation to file')
  const { link } = await recordInboxMessage(db, mailbox.tenant_id, latest)
  if (!link) throw new FileThreadError('The email could not be recorded — try again', 409)
}

export async function fileThread(
  mailbox: Mailbox,
  threadId: string,
  target: { jobId: string } | { filing: Exclude<Filing, 'job'> },
  db = mailDb(),
): Promise<Filing | null> {
  const tenantId = mailbox.tenant_id
  await recordIfUnknown(mailbox, threadId, db)

  if ('jobId' in target) {
    const { data: job } = await db.from('jobs').select('id').eq('tenant_id', tenantId).eq('id', target.jobId).maybeSingle()
    if (!job) throw new FileThreadError('Job not found', 404)
    // Chosen by hand, so it moves from any other job too
    await db.from('communications')
      .update({ job_id: target.jobId, match_candidates: null })
      .eq('tenant_id', tenantId).eq('thread_id', threadId)
      .not('job_id', 'is', null).neq('job_id', target.jobId)
    await linkThreadToJob(db, tenantId, threadId, target.jobId)
  } else {
    const { count } = await db.from('communications').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('thread_id', threadId).not('job_id', 'is', null)
    if ((count ?? 0) > 0) throw new FileThreadError('This conversation is on a job — move it to another job instead', 409)
    await setThreadCategory(db, tenantId, threadId, target.filing === 'admin' ? 'admin' : 'unlinked')
  }

  await refreshFiling(db, tenantId, [threadId])
  const { data } = await db.from('mail_threads').select('filing').eq('mailbox_id', mailbox.id).eq('gmail_thread_id', threadId).maybeSingle()
  return ((data as { filing: Filing | null } | null)?.filing) ?? null
}
