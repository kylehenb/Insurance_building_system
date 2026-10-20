import type { SupabaseClient } from '@supabase/supabase-js'
import { matchJob, type JobCandidate } from './match-job'
import { findThreadJobId } from './thread-link'
import { isAdminEmail } from './admin-filter'

export type CommunicationLink = {
  job_id: string | null
  /**
   * inbound      — follow-up in a thread already linked to a job
   * auto_linked  — matched to a job from its content
   * unlinked     — needs a human; match_candidates may hold suggestions
   * admin        — not job correspondence (notifications, compliance, newsletters)
   */
  source: 'inbound' | 'auto_linked' | 'unlinked' | 'admin'
  match_candidates: JobCandidate[] | null
}

/**
 * Decides which job an inbound (non-order) email belongs to:
 *   1. the job its Gmail thread is already linked to
 *   2. a confident content match (job/claim number, address)
 *   3. otherwise unlinked with suggestions, or 'admin' if it's clearly not job mail
 *
 * Callers should run linkThreadToJob() after inserting when job_id is set and
 * source is 'auto_linked', so earlier unlinked messages in the thread follow.
 */
export async function resolveCommunicationLink(params: {
  db: SupabaseClient
  tenantId: string
  threadId: string | null
  subject: string
  body: string
  fromEmail: string
}): Promise<CommunicationLink> {
  const { db, tenantId, threadId, subject, body, fromEmail } = params

  const threadJobId = await findThreadJobId(db, tenantId, threadId)
  if (threadJobId) {
    return { job_id: threadJobId, source: 'inbound', match_candidates: null }
  }

  let candidates: JobCandidate[] = []
  try {
    const match = await matchJob({ subject, body, from_email: fromEmail, tenant_id: tenantId })
    if (match.job_id && match.confidence === 'high') {
      return { job_id: match.job_id, source: 'auto_linked', match_candidates: null }
    }
    candidates = match.candidates
  } catch (err) {
    console.error('[resolve-link] matchJob error:', err)
  }

  if (candidates.length > 0) {
    return { job_id: null, source: 'unlinked', match_candidates: candidates }
  }

  if (isAdminEmail({ fromEmail, subject, body })) {
    return { job_id: null, source: 'admin', match_candidates: null }
  }

  return { job_id: null, source: 'unlinked', match_candidates: null }
}
