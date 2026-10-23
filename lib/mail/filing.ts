import { createClient as createRawClient, type SupabaseClient } from '@supabase/supabase-js'

// Where a conversation stands in IRC (mail_threads.filing / job_id — see
// migration 20261106_mail_irc.sql), worked out from the emails filed in
// communications (insurer order emails wait in the Insurer Orders queue, so
// they aren't "to file"). Kept separate from the Gmail sync so the filing functions
// in lib/communications can call it without loading Gmail.

export type Filing = 'job' | 'to_file' | 'admin'

export const FILINGS: { key: Filing; label: string }[] = [
  { key: 'job', label: 'Jobs' },
  { key: 'to_file', label: 'To file' },
  { key: 'admin', label: 'Admin' },
]

export function isFiling(value: unknown): value is Filing {
  return value === 'job' || value === 'to_file' || value === 'admin'
}

type CommRow = { thread_id: string; job_id: string | null; source: string | null; direction: string | null; insurer_order_id: string | null; created_at: string | null }

/** The filing of a conversation from its filed emails (newest first) */
export function filingOf(rows: Omit<CommRow, 'thread_id'>[]): { filing: Filing | null; jobId: string | null } {
  const linked = rows.find(r => r.job_id)
  if (linked) return { filing: 'job', jobId: linked.job_id }
  if (rows.some(r => r.source === 'admin')) return { filing: 'admin', jobId: null }
  // An order email waits in the Insurer Orders queue, and is filed when lodged
  if (rows.some(r => r.insurer_order_id)) return { filing: null, jobId: null }
  if (rows.some(r => r.direction === 'inbound')) return { filing: 'to_file', jobId: null }
  return { filing: null, jobId: null }
}

export async function filingForThreads(db: SupabaseClient, tenantId: string, threadIds: string[]): Promise<Map<string, { filing: Filing | null; jobId: string | null }>> {
  const out = new Map<string, { filing: Filing | null; jobId: string | null }>()
  for (let i = 0; i < threadIds.length; i += 200) {
    const batch = threadIds.slice(i, i + 200)
    const { data } = await db
      .from('communications')
      .select('thread_id, job_id, source, direction, insurer_order_id, created_at')
      .eq('tenant_id', tenantId)
      .in('thread_id', batch)
      .order('created_at', { ascending: false })
    const byThread = new Map<string, CommRow[]>()
    for (const r of (data as CommRow[] | null) ?? []) byThread.set(r.thread_id, [...(byThread.get(r.thread_id) ?? []), r])
    for (const id of batch) out.set(id, filingOf(byThread.get(id) ?? []))
  }
  return out
}

/** Writes the filing of these conversations into the mirror */
export async function refreshFiling(db: SupabaseClient, tenantId: string, threadIds: string[]): Promise<void> {
  if (!threadIds.length) return
  const filings = await filingForThreads(db, tenantId, threadIds)
  await Promise.all([...filings].map(([id, f]) =>
    db.from('mail_threads').update({ filing: f.filing, job_id: f.jobId }).eq('tenant_id', tenantId).eq('gmail_thread_id', id)))
}

/**
 * For the filing functions (link to job, file as admin): updates the Mail
 * page's copy too. They may run with the signed-in user's client, which
 * can't write the mirror, so this uses the service role. Never throws.
 */
export async function refreshThreadFiling(tenantId: string, threadId: string | null | undefined): Promise<void> {
  if (!threadId) return
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return
    await refreshFiling(createRawClient(url, key), tenantId, [threadId])
  } catch (err) {
    console.error('[mail-filing] could not refresh thread filing:', err)
  }
}
