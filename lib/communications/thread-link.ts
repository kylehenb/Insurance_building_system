import type { SupabaseClient } from '@supabase/supabase-js'

// Gmail thread ↔ job linking.
//
// A Gmail thread is one conversation, so once any message in it is linked to
// a job, every other message in it (past and future) belongs to that job too.

/**
 * Returns the job a Gmail thread is linked to, or null.
 * Looks at the most recent linked message so a manual link wins over older
 * unlinked rows, then falls back to an insurer order that has been lodged.
 */
export async function findThreadJobId(
  db: SupabaseClient,
  tenantId: string,
  threadId: string | null | undefined,
): Promise<string | null> {
  if (!threadId) return null

  const { data: linked } = await db
    .from('communications')
    .select('job_id')
    .eq('tenant_id', tenantId)
    .eq('thread_id', threadId)
    .not('job_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)

  const jobId = (linked as { job_id: string }[] | null)?.[0]?.job_id
  if (jobId) return jobId

  // Thread started as an insurer order — once lodged, the order carries the job
  const { data: orderComms } = await db
    .from('communications')
    .select('insurer_order_id')
    .eq('tenant_id', tenantId)
    .eq('thread_id', threadId)
    .not('insurer_order_id', 'is', null)
    .limit(1)

  const orderId = (orderComms as { insurer_order_id: string }[] | null)?.[0]?.insurer_order_id
  if (!orderId) return null

  const { data: order } = await db
    .from('insurer_orders')
    .select('job_id')
    .eq('id', orderId)
    .limit(1)

  return (order as { job_id: string | null }[] | null)?.[0]?.job_id ?? null
}

/** Returns true if any communications row already exists for this thread. */
export async function threadExists(
  db: SupabaseClient,
  tenantId: string,
  threadId: string | null | undefined,
): Promise<boolean> {
  if (!threadId) return false
  const { count } = await db
    .from('communications')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('thread_id', threadId)
  return (count ?? 0) > 0
}

/**
 * Links every still-unlinked message in a Gmail thread to a job.
 * Never overwrites a row already linked to a different job.
 * Returns the number of rows linked.
 */
export async function linkThreadToJob(
  db: SupabaseClient,
  tenantId: string,
  threadId: string | null | undefined,
  jobId: string,
): Promise<number> {
  if (!threadId) return 0

  // Rows the inbox showed as unlinked/admin get a source that says why they're now linked
  await db
    .from('communications')
    .update({ source: 'thread_linked' })
    .eq('tenant_id', tenantId)
    .eq('thread_id', threadId)
    .is('job_id', null)
    .in('source', ['unlinked', 'admin'])

  const { data, error } = await db
    .from('communications')
    .update({ job_id: jobId, match_candidates: null })
    .eq('tenant_id', tenantId)
    .eq('thread_id', threadId)
    .is('job_id', null)
    .select('id')

  if (error) {
    console.error(`[thread-link] failed to link thread ${threadId} to job ${jobId}:`, error)
    return 0
  }
  return data?.length ?? 0
}

/**
 * Files every unlinked message in a thread as admin (not job related), or
 * moves admin messages back to the unlinked inbox. Linked messages are untouched.
 * Returns the number of rows changed.
 */
export async function setThreadCategory(
  db: SupabaseClient,
  tenantId: string,
  threadId: string | null | undefined,
  category: 'admin' | 'unlinked',
): Promise<number> {
  if (!threadId) return 0
  const { data, error } = await db
    .from('communications')
    .update({ source: category })
    .eq('tenant_id', tenantId)
    .eq('thread_id', threadId)
    .is('job_id', null)
    .or(`source.is.null,source.neq.${category}`)
    .select('id')
  if (error) {
    console.error(`[thread-link] failed to set thread ${threadId} to ${category}:`, error)
    return 0
  }
  return data?.length ?? 0
}

/** Returns true if an unlinked message in this thread has been filed as admin. */
export async function isAdminThread(
  db: SupabaseClient,
  tenantId: string,
  threadId: string | null | undefined,
): Promise<boolean> {
  if (!threadId) return false
  const { count } = await db
    .from('communications')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('thread_id', threadId)
    .is('job_id', null)
    .eq('source', 'admin')
  return (count ?? 0) > 0
}

/**
 * After an insurer order is lodged/linked to a job, link its email thread(s)
 * so the original order email and any replies leave the unlinked inbox.
 */
export async function linkOrderThreadsToJob(
  db: SupabaseClient,
  tenantId: string,
  orderId: string,
  jobId: string,
): Promise<void> {
  const { data } = await db
    .from('communications')
    .select('id, thread_id')
    .eq('tenant_id', tenantId)
    .eq('insurer_order_id', orderId)

  const rows = (data as { id: string; thread_id: string | null }[] | null) ?? []

  await db
    .from('communications')
    .update({ job_id: jobId })
    .eq('tenant_id', tenantId)
    .eq('insurer_order_id', orderId)
    .is('job_id', null)

  const threadIds = new Set(rows.map(r => r.thread_id).filter((t): t is string => Boolean(t)))
  for (const threadId of threadIds) {
    await linkThreadToJob(db, tenantId, threadId, jobId)
  }
}
