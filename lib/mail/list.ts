import type { SupabaseClient } from '@supabase/supabase-js'
import { getGmailClient } from '@/lib/gmail/client'
import { findThreadJobId } from '@/lib/communications/thread-link'
import { folderLabel, HIDDEN_LABELS, type FolderKey } from './folders'
import { parseMessage, resolveCidImages, type MailMessage } from './message'
import { fetchThreads, mailDb, storeThread, type Mailbox } from './sync'
import type { MailAddress, Participant } from './summary'

// Reading the mailbox for the mail page: folder lists come from the mirror,
// search goes to Gmail, an opened conversation is fetched from Gmail.

export type JobChip = { id: string; job_number: string; insured_name: string | null }

export type ThreadListItem = {
  id: string
  subject: string
  snippet: string
  participants: Participant[]
  recipients: MailAddress[]
  last_message_at: string | null
  message_count: number
  label_ids: string[]
  unread: boolean
  has_attachments: boolean
  job: JobChip | null
}

export type ThreadPage = {
  threads: ThreadListItem[]
  /** Pass back as `cursor` for the next page; null at the end */
  cursor: string | null
}

export type FolderCounts = { inbox: number; drafts: number; spam: number }

export type ThreadDetail = {
  id: string
  subject: string
  label_ids: string[]
  messages: MailMessage[]
  job: JobChip | null
}

const LIST_COLUMNS =
  'gmail_thread_id, subject, snippet, participants, recipients, last_message_at, message_count, label_ids, unread, has_attachments'

type Row = Omit<ThreadListItem, 'id' | 'job'> & { gmail_thread_id: string }

const PAGE_SIZE = 50

/** Job chips for a set of Gmail threads, from the emails filed on jobs */
export async function jobsForThreads(tenantId: string, threadIds: string[], db: SupabaseClient = mailDb()): Promise<Map<string, JobChip>> {
  const chips = new Map<string, JobChip>()
  if (threadIds.length === 0) return chips

  const { data: comms } = await db
    .from('communications')
    .select('thread_id, job_id, created_at')
    .eq('tenant_id', tenantId)
    .in('thread_id', threadIds)
    .not('job_id', 'is', null)
    .order('created_at', { ascending: false })
  const jobByThread = new Map<string, string>()
  // Newest link wins, matching findThreadJobId
  for (const c of (comms as { thread_id: string; job_id: string }[] | null) ?? []) {
    if (!jobByThread.has(c.thread_id)) jobByThread.set(c.thread_id, c.job_id)
  }
  if (jobByThread.size === 0) return chips

  const { data: jobs } = await db
    .from('jobs')
    .select('id, job_number, insured_name')
    .eq('tenant_id', tenantId)
    .in('id', [...new Set(jobByThread.values())])
  const byId = new Map(((jobs as JobChip[] | null) ?? []).map(j => [j.id, j]))
  for (const [threadId, jobId] of jobByThread) {
    const job = byId.get(jobId)
    if (job) chips.set(threadId, job)
  }
  return chips
}

async function withJobs(mailbox: Mailbox, rows: Row[], db: SupabaseClient): Promise<ThreadListItem[]> {
  const chips = await jobsForThreads(mailbox.tenant_id, rows.map(r => r.gmail_thread_id), db)
  return rows.map(r => ({
    id: r.gmail_thread_id,
    subject: r.subject,
    snippet: r.snippet,
    participants: r.participants,
    recipients: r.recipients,
    last_message_at: r.last_message_at,
    message_count: r.message_count,
    label_ids: r.label_ids,
    unread: r.unread,
    has_attachments: r.has_attachments,
    job: chips.get(r.gmail_thread_id) ?? null,
  }))
}

/** A folder from the mirror, newest first. cursor is the last row's last_message_at. */
export async function listFolder(mailbox: Mailbox, folder: FolderKey, cursor: string | null, db = mailDb()): Promise<ThreadPage> {
  let query = db
    .from('mail_threads')
    .select(LIST_COLUMNS)
    .eq('mailbox_id', mailbox.id)
    .not('synced_at', 'is', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(PAGE_SIZE)

  const label = folderLabel(folder)
  query = label
    ? query.contains('label_ids', [label])
    : query.not('label_ids', 'ov', `{${HIDDEN_LABELS.join(',')}}`)
  if (cursor) query = query.lt('last_message_at', cursor)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = (data as Row[] | null) ?? []
  return {
    threads: await withJobs(mailbox, rows, db),
    cursor: rows.length === PAGE_SIZE ? rows[rows.length - 1].last_message_at : null,
  }
}

/**
 * Gmail search (same syntax as the Gmail search box) within a folder.
 * Results not yet in the mirror — older mail — are fetched on the way.
 * cursor is Gmail's page token.
 */
export async function searchFolder(mailbox: Mailbox, folder: FolderKey, q: string, cursor: string | null, db = mailDb()): Promise<ThreadPage> {
  const label = folderLabel(folder)
  const res = await getGmailClient().users.threads.list({
    userId: 'me',
    q,
    labelIds: label ? [label] : undefined,
    includeSpamTrash: label !== null && HIDDEN_LABELS.includes(label),
    maxResults: PAGE_SIZE,
    pageToken: cursor ?? undefined,
  })
  const ids = (res.data.threads ?? []).map(t => t.id).filter((id): id is string => !!id)

  const load = async () => {
    const { data } = await db
      .from('mail_threads')
      .select(`${LIST_COLUMNS}, stale`)
      .eq('mailbox_id', mailbox.id)
      .in('gmail_thread_id', ids)
    return ((data as (Row & { stale: boolean })[] | null) ?? [])
  }

  let rows = ids.length ? await load() : []
  const missing = ids.filter(id => !rows.some(r => r.gmail_thread_id === id && !r.stale))
  if (missing.length) {
    await fetchThreads(mailbox, missing, db)
    rows = await load()
  }

  const byId = new Map(rows.map(r => [r.gmail_thread_id, r]))
  const ordered = ids.map(id => byId.get(id)).filter((r): r is Row & { stale: boolean } => !!r && r.subject !== null)
  return {
    threads: await withJobs(mailbox, ordered, db),
    cursor: res.data.nextPageToken ?? null,
  }
}

export async function folderCounts(mailbox: Mailbox, db = mailDb()): Promise<FolderCounts> {
  const count = async (label: string, unreadOnly: boolean) => {
    let q = db
      .from('mail_threads')
      .select('id', { count: 'exact', head: true })
      .eq('mailbox_id', mailbox.id)
      .not('synced_at', 'is', null)
      .contains('label_ids', [label])
    if (unreadOnly) q = q.eq('unread', true)
    const { count } = await q
    return count ?? 0
  }
  const [inbox, drafts, spam] = await Promise.all([
    count('INBOX', true),
    count('DRAFT', false),
    count('SPAM', true),
  ])
  return { inbox, drafts, spam }
}

/** An opened conversation, fetched from Gmail. Also refreshes its row in the mirror. Null if it's gone. */
export async function getThreadDetail(mailbox: Mailbox, threadId: string, db = mailDb()): Promise<ThreadDetail | null> {
  let thread
  try {
    const res = await getGmailClient().users.threads.get({ userId: 'me', id: threadId, format: 'full' })
    thread = res.data
  } catch (err) {
    const status = (err as { code?: number }).code
    if (status === 404) {
      await db.from('mail_threads').delete().eq('mailbox_id', mailbox.id).eq('gmail_thread_id', threadId)
      return null
    }
    throw err
  }

  await storeThread(mailbox, thread, db)

  const messages = (thread.messages ?? [])
    .map(parseMessage)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    .map(m => ({ ...m, html: resolveCidImages(m.html, m.id, m.attachments) }))
    // Inline parts are now data: URLs in the html; don't send them twice
    .map(m => ({ ...m, attachments: m.attachments.map(a => ({ ...a, data: null })) }))

  const labels = new Set<string>()
  for (const m of messages) for (const l of m.labelIds) labels.add(l)

  const jobId = await findThreadJobId(db, mailbox.tenant_id, threadId)
  let job: JobChip | null = null
  if (jobId) {
    const { data } = await db.from('jobs').select('id, job_number, insured_name').eq('id', jobId).single()
    job = (data as JobChip | null) ?? null
  }

  const firstSent = messages.find(m => !m.labelIds.includes('DRAFT')) ?? messages[0]
  return {
    id: threadId,
    subject: firstSent?.subject ?? '',
    label_ids: [...labels].sort(),
    messages,
    job,
  }
}
