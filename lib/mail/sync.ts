import { createClient as createRawClient, type SupabaseClient } from '@supabase/supabase-js'
import type { gmail_v1 } from 'googleapis'
import { getGmailClient } from '@/lib/gmail/client'
import { historyThreadIds, summariseThread } from './summary'

// Keeps the mail_threads mirror in step with Gmail (see the migration
// 20261102_mailbox_mirror.sql for the model). Gmail is the source of truth:
// every write here comes from what Gmail reports, so running a sync twice, or
// two at once, is harmless.
//
// A sync run:
//   1. reads Gmail's change history since mailboxes.history_id and queues
//      every thread it touched (stale = true);
//   2. on the first run, or after the history cursor expires, queues the
//      recent threads of each folder (the backfill);
//   3. fetches queued threads newest-first until its time budget runs out.
//      Whatever is left is picked up by the next run.

export type Mailbox = {
  id: string
  tenant_id: string
  email_address: string
  history_id: string | null
  backfilled_at: string | null
  synced_at: string | null
  sync_error: string | null
}

export type SyncResult = {
  changed: number
  fetched: number
  remaining: number
  error?: string
}

/** How much of each folder the backfill queues. Older mail is reached through search. */
const BACKFILL: { labelIds?: string[]; q?: string; max: number }[] = [
  { labelIds: ['INBOX'], max: 1000 },
  { labelIds: ['DRAFT'], max: 200 },
  { labelIds: ['SENT'], max: 500 },
  { labelIds: ['SPAM'], max: 200 },
  { labelIds: ['TRASH'], max: 200 },
  { q: 'newer_than:90d', max: 2000 },
]

const FETCH_CONCURRENCY = 8
const FETCH_BATCH = 40

/** Service-role client without generated types — these tables are newer than database.types.ts */
export function mailDb(): SupabaseClient {
  return createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

/**
 * The tenant's mailbox, created on first use. Today that's the one Gmail
 * account the app is connected to (office@); each staff inbox becomes another
 * row once there's a Gmail connection per mailbox.
 */
export async function getMailbox(tenantId: string, db = mailDb()): Promise<Mailbox> {
  const { data } = await db
    .from('mailboxes')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(1)
  const existing = (data as Mailbox[] | null)?.[0]
  if (existing) return existing

  const profile = await getGmailClient().users.getProfile({ userId: 'me' })
  const email = profile.data.emailAddress
  if (!email) throw new Error('Gmail profile has no email address')

  const { data: created, error } = await db
    .from('mailboxes')
    .upsert({ tenant_id: tenantId, email_address: email.toLowerCase() }, { onConflict: 'tenant_id,email_address' })
    .select('*')
    .single()
  if (error || !created) throw new Error(`Could not create mailbox: ${error?.message}`)
  return created as Mailbox
}

export async function getMailboxByEmail(email: string, db = mailDb()): Promise<Mailbox | null> {
  const { data } = await db
    .from('mailboxes')
    .select('*')
    .eq('email_address', email.toLowerCase())
    .limit(1)
  return (data as Mailbox[] | null)?.[0] ?? null
}

/** Queues threads for fetching. Later queue times are fetched first. */
export async function queueThreads(mailbox: Mailbox, threadIds: string[], queuedAt = Date.now(), db = mailDb()) {
  for (let i = 0; i < threadIds.length; i += 500) {
    const rows = threadIds.slice(i, i + 500).map((id, j) => ({
      tenant_id: mailbox.tenant_id,
      mailbox_id: mailbox.id,
      gmail_thread_id: id,
      stale: true,
      // Keep the given order: the first id is the most urgent
      queued_at: new Date(queuedAt - (i + j)).toISOString(),
    }))
    const { error } = await db.from('mail_threads').upsert(rows, { onConflict: 'mailbox_id,gmail_thread_id' })
    if (error) throw new Error(`Could not queue threads: ${error.message}`)
  }
}

/** Writes a thread Gmail returned (any format) into the mirror, or removes it if it has no messages */
export async function storeThread(mailbox: Mailbox, thread: gmail_v1.Schema$Thread, db = mailDb()) {
  if (!thread.id) return
  const summary = summariseThread(thread)
  if (!summary) {
    await db.from('mail_threads').delete().eq('mailbox_id', mailbox.id).eq('gmail_thread_id', thread.id)
    return
  }
  const { error } = await db.from('mail_threads').upsert(
    {
      tenant_id: mailbox.tenant_id,
      mailbox_id: mailbox.id,
      gmail_thread_id: thread.id,
      ...summary,
      stale: false,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'mailbox_id,gmail_thread_id' },
  )
  if (error) throw new Error(`Could not store thread ${thread.id}: ${error.message}`)
}

function isNotFound(err: unknown): boolean {
  const e = err as { code?: number; status?: number; response?: { status?: number } }
  return e?.code === 404 || e?.status === 404 || e?.response?.status === 404
}

/** Fetches threads from Gmail and stores them. Returns how many were fetched. */
export async function fetchThreads(mailbox: Mailbox, threadIds: string[], db = mailDb()): Promise<number> {
  const gmail = getGmailClient()
  let fetched = 0
  let next = 0

  async function worker() {
    while (next < threadIds.length) {
      const id = threadIds[next++]
      try {
        const res = await gmail.users.threads.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'],
        })
        await storeThread(mailbox, res.data, db)
        fetched++
      } catch (err) {
        if (isNotFound(err)) {
          // Deleted forever in Gmail
          await db.from('mail_threads').delete().eq('mailbox_id', mailbox.id).eq('gmail_thread_id', id)
          continue
        }
        console.error(`[mail-sync] could not fetch thread ${id}:`, err)
        // Send it to the back of the queue so one bad thread can't block the rest
        await db
          .from('mail_threads')
          .update({ queued_at: new Date(0).toISOString() })
          .eq('mailbox_id', mailbox.id)
          .eq('gmail_thread_id', id)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, threadIds.length) }, worker))
  return fetched
}

async function listThreadIds(gmail: gmail_v1.Gmail, opts: { labelIds?: string[]; q?: string; max: number }): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const res = await gmail.users.threads.list({
      userId: 'me',
      labelIds: opts.labelIds,
      q: opts.q,
      includeSpamTrash: opts.labelIds?.some(l => l === 'SPAM' || l === 'TRASH') ?? false,
      maxResults: Math.min(500, opts.max - ids.length),
      pageToken,
    })
    for (const t of res.data.threads ?? []) if (t.id) ids.push(t.id)
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken && ids.length < opts.max)
  return ids
}

/** Thread ids changed since the cursor, and the cursor to store next. Null when the cursor has expired. */
async function readHistory(gmail: gmail_v1.Gmail, startHistoryId: string): Promise<{ threadIds: string[]; historyId: string } | null> {
  const history: gmail_v1.Schema$History[] = []
  let historyId = startHistoryId
  let pageToken: string | undefined
  try {
    do {
      const res = await gmail.users.history.list({ userId: 'me', startHistoryId, pageToken, maxResults: 500 })
      history.push(...(res.data.history ?? []))
      if (res.data.historyId) historyId = res.data.historyId
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
  } catch (err) {
    // Gmail keeps about a week of history; an older cursor gets a 404
    if (isNotFound(err)) return null
    throw err
  }
  return { threadIds: historyThreadIds(history), historyId }
}

const laterHistoryId = (a: string | null, b: string) => (a && BigInt(a) > BigInt(b) ? a : b)

/**
 * One sync run (see the top of this file). budgetMs is how long it may
 * spend fetching threads before leaving the rest for the next run.
 */
export async function syncMailbox(mailbox: Mailbox, { budgetMs = 60_000 } = {}, db = mailDb()): Promise<SyncResult> {
  const started = Date.now()
  const gmail = getGmailClient()
  let changed = 0
  let fetched = 0

  try {
    let historyId = mailbox.history_id
    let backfilledAt = mailbox.backfilled_at

    if (historyId) {
      const changes = await readHistory(gmail, historyId)
      if (changes) {
        await queueThreads(mailbox, changes.threadIds, Date.now(), db)
        changed = changes.threadIds.length
        historyId = changes.historyId
      } else {
        historyId = null
        backfilledAt = null
      }
    }

    if (!historyId) {
      // Take the cursor before listing, so changes made during the backfill are caught next run
      const profile = await gmail.users.getProfile({ userId: 'me' })
      historyId = profile.data.historyId ?? null
    }

    if (!backfilledAt) {
      // Queued behind live changes, in folder order
      let at = Date.now() - 60_000
      for (const spec of BACKFILL) {
        const ids = await listThreadIds(gmail, spec)
        await queueThreads(mailbox, ids, at, db)
        at -= ids.length + 1
      }
      backfilledAt = new Date().toISOString()
    }

    // Save the cursor before fetching: the queue holds the work, so a timeout loses nothing
    const { data: current } = await db.from('mailboxes').select('history_id').eq('id', mailbox.id).single()
    await db
      .from('mailboxes')
      .update({
        history_id: historyId ? laterHistoryId((current as { history_id: string | null } | null)?.history_id ?? null, historyId) : null,
        backfilled_at: backfilledAt,
      })
      .eq('id', mailbox.id)

    // Threads that failed go to the back of the queue; don't retry them this run
    const attempted = new Set<string>()
    while (Date.now() - started < budgetMs) {
      const { data: queued } = await db
        .from('mail_threads')
        .select('gmail_thread_id')
        .eq('mailbox_id', mailbox.id)
        .eq('stale', true)
        .order('queued_at', { ascending: false })
        .limit(FETCH_BATCH)
      const ids = ((queued as { gmail_thread_id: string }[] | null) ?? [])
        .map(r => r.gmail_thread_id)
        .filter(id => !attempted.has(id))
      if (ids.length === 0) break
      for (const id of ids) attempted.add(id)
      fetched += await fetchThreads(mailbox, ids, db)
    }

    const { count } = await db
      .from('mail_threads')
      .select('id', { count: 'exact', head: true })
      .eq('mailbox_id', mailbox.id)
      .eq('stale', true)

    await db.from('mailboxes').update({ synced_at: new Date().toISOString(), sync_error: null }).eq('id', mailbox.id)
    return { changed, fetched, remaining: count ?? 0 }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[mail-sync] sync failed:', err)
    await db.from('mailboxes').update({ sync_error: message }).eq('id', mailbox.id)
    return { changed, fetched, remaining: -1, error: message }
  }
}
