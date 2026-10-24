import type { SupabaseClient } from '@supabase/supabase-js'
import { getGmailClient } from '@/lib/gmail/client'
import { findThreadJobId } from '@/lib/communications/thread-link'
import { folderLabel, HIDDEN_LABELS, TAB_LABELS, tabLabel, type FolderKey, type TabKey } from './folders'
import { parseMessage, resolveCidImages, type MailMessage } from './message'
import { fetchThreads, mailDb, storeThread, type Mailbox } from './sync'
import { draftsInThread } from './compose'
import { refreshFiling, type Filing } from './filing'
import { orderForEmail } from '@/lib/insurer-orders/from-email'
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
  /** On a job, to file, admin — or null if the app never recorded it */
  filing: Filing | null
}

export type ThreadPage = {
  threads: ThreadListItem[]
  /** Pass back as `cursor` for the next page; null at the end */
  cursor: string | null
}

export type FolderCounts = { inbox: number; promotions: number; social: number; drafts: number; spam: number; toFile: number }

export type ThreadDetail = {
  id: string
  subject: string
  label_ids: string[]
  messages: MailMessage[]
  job: JobChip | null
  /** Gmail drafts in the conversation, by the draft message's id */
  drafts: { draftId: string; messageId: string }[]
  filing: Filing | null
  /** Jobs the matcher suggested for an email not on a job yet */
  candidates: JobCandidate[]
  /** The insurer order the conversation became, if any */
  orderId: string | null
}

export type JobCandidate = { job_id: string; job_number: string; insured_name: string | null; property_address: string | null; matched_on: string[]; confidence: string }

const LIST_COLUMNS =
  'gmail_thread_id, subject, snippet, participants, recipients, last_message_at, message_count, label_ids, unread, has_attachments, filing, job_id'

type Row = Omit<ThreadListItem, 'id' | 'job'> & { gmail_thread_id: string; job_id: string | null }

const PAGE_SIZE = 50

async function withJobs(mailbox: Mailbox, rows: Row[], db: SupabaseClient): Promise<ThreadListItem[]> {
  const jobIds = [...new Set(rows.map(r => r.job_id).filter((id): id is string => !!id))]
  const { data: jobs } = jobIds.length
    ? await db.from('jobs').select('id, job_number, insured_name').eq('tenant_id', mailbox.tenant_id).in('id', jobIds)
    : { data: [] }
  const byId = new Map(((jobs as JobChip[] | null) ?? []).map(j => [j.id, j]))
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
    job: r.job_id ? byId.get(r.job_id) ?? null : null,
    filing: r.filing,
  }))
}

/** The mirror's version of inFolder (lib/mail/folders.ts) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function whereInFolder<Q extends { contains: any; not: any; eq: any }>(query: Q, folder: FolderKey, tab: TabKey | null, filing: Filing | null = null): Q {
  const label = folderLabel(folder)
  let q = query
  if (filing) q = q.eq('filing', filing)
  if (label !== 'SPAM' && label !== 'TRASH') q = q.not('label_ids', 'ov', `{${HIDDEN_LABELS.join(',')}}`)
  if (label) q = q.contains('label_ids', [label])
  if (folder === 'inbox' && tab) {
    const t = tabLabel(tab)
    q = t ? q.contains('label_ids', [t]) : q.not('label_ids', 'ov', `{${TAB_LABELS.join(',')}}`)
  }
  return q
}

/** A folder from the mirror, newest first. cursor is the last row's last_message_at. */
export async function listFolder(mailbox: Mailbox, folder: FolderKey, tab: TabKey | null, cursor: string | null, db = mailDb(), filing: Filing | null = null): Promise<ThreadPage> {
  let query = db
    .from('mail_threads')
    .select(LIST_COLUMNS)
    .eq('mailbox_id', mailbox.id)
    .not('synced_at', 'is', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(PAGE_SIZE)

  query = whereInFolder(query, folder, tab, filing)
  if (cursor) query = query.lt('last_message_at', cursor)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = (data as Row[] | null) ?? []
  return {
    threads: await withJobs(mailbox, rows, db),
    cursor: rows.length === PAGE_SIZE ? rows[rows.length - 1].last_message_at : null,
  }
}

/** Given conversations from the mirror, newest first — the Starred folder (its ids come from the action cards) */
export async function listThreadsById(mailbox: Mailbox, ids: string[], db = mailDb()): Promise<ThreadPage> {
  if (!ids.length) return { threads: [], cursor: null }
  const { data, error } = await db
    .from('mail_threads')
    .select(LIST_COLUMNS)
    .eq('mailbox_id', mailbox.id)
    .in('gmail_thread_id', ids)
    .not('synced_at', 'is', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
  if (error) throw new Error(error.message)
  const rows = ((data as Row[] | null) ?? []).filter(r => r.subject !== null)
  return { threads: await withJobs(mailbox, rows, db), cursor: null }
}

/**
 * Gmail search (same syntax as the Gmail search box) within a folder.
 * Results not yet in the mirror — older mail — are fetched on the way.
 * cursor is Gmail's page token.
 */
export async function searchFolder(mailbox: Mailbox, folder: FolderKey, tab: TabKey | null, q: string, cursor: string | null, db = mailDb(), filing: Filing | null = null): Promise<ThreadPage> {
  const label = folderLabel(folder)
  const tabL = folder === 'inbox' && tab ? tabLabel(tab) : null
  const primary = folder === 'inbox' && tab === 'primary'
  const res = await getGmailClient().users.threads.list({
    userId: 'me',
    q: primary ? `${q} -category:promotions -category:social` : q,
    labelIds: [label, tabL].filter((l): l is string => !!l),
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
  const ordered = ids.map(id => byId.get(id))
    .filter((r): r is Row & { stale: boolean } => !!r && r.subject !== null && (!filing || r.filing === filing))
  return {
    threads: await withJobs(mailbox, ordered, db),
    cursor: res.data.nextPageToken ?? null,
  }
}

/** Unread counts for the folder list, as Gmail shows them (the inbox counts its Primary tab) */
export async function folderCounts(mailbox: Mailbox, db = mailDb()): Promise<FolderCounts> {
  const count = async (folder: FolderKey, tab: TabKey | null, unreadOnly: boolean) => {
    let q = db
      .from('mail_threads')
      .select('id', { count: 'exact', head: true })
      .eq('mailbox_id', mailbox.id)
      .not('synced_at', 'is', null)
    q = whereInFolder(q, folder, tab)
    if (unreadOnly) q = q.eq('unread', true)
    const { count } = await q
    return count ?? 0
  }
  const toFileQuery = whereInFolder(
    db.from('mail_threads').select('id', { count: 'exact', head: true }).eq('mailbox_id', mailbox.id).not('synced_at', 'is', null),
    'inbox', null, 'to_file')
  const [inbox, promotions, social, drafts, spam, toFile] = await Promise.all([
    count('inbox', 'primary', true),
    count('inbox', 'promotions', true),
    count('inbox', 'social', true),
    count('drafts', null, false),
    count('spam', null, true),
    toFileQuery.then(r => r.count ?? 0),
  ])
  return { inbox, promotions, social, drafts, spam, toFile }
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

  const drafts = labels.has('DRAFT') ? await draftsInThread(threadId) : []

  await refreshFiling(db, mailbox.tenant_id, [threadId])
  const [{ data: mirror }, { data: suggested }, orderId] = await Promise.all([
    db.from('mail_threads').select('filing').eq('mailbox_id', mailbox.id).eq('gmail_thread_id', threadId).maybeSingle(),
    db.from('communications').select('match_candidates').eq('tenant_id', mailbox.tenant_id).eq('thread_id', threadId)
      .is('job_id', null).not('match_candidates', 'is', null).order('created_at', { ascending: false }).limit(1),
    orderForEmail(db, mailbox.tenant_id, messages.find(m => !m.labelIds.includes('SENT'))?.id ?? threadId, threadId),
  ])
  const candidates = ((suggested as { match_candidates: JobCandidate[] | null }[] | null)?.[0]?.match_candidates ?? [])

  const firstSent = messages.find(m => !m.labelIds.includes('DRAFT')) ?? messages[0]
  return {
    id: threadId,
    subject: firstSent?.subject ?? '',
    label_ids: [...labels].sort(),
    messages,
    job,
    drafts,
    filing: (mirror as { filing: Filing | null } | null)?.filing ?? null,
    candidates: Array.isArray(candidates) ? candidates : [],
    orderId,
  }
}
