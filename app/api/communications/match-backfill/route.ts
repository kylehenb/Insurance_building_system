/**
 * Retroactive job-matching for communications rows that have job_id: null.
 *
 * GET  /api/communications/match-backfill
 *   Dry-run: returns { total, eligible } — no writes.
 *   eligible = rows with job_id IS NULL that haven't been matched yet.
 *
 * POST /api/communications/match-backfill
 *   Body (optional): { max?: number, rematch?: boolean }  — default 50
 *   Processes up to `max` unlinked rows oldest-first: thread → content match →
 *   unlinked/admin, same as the inbound webhook.
 *   Safe to re-run: rows already attempted (match_candidates set OR
 *   job_id set) are skipped unless rematch is true. Rematch pages with
 *   `after` (a created_at) — keep posting the returned next_after until null.
 *   Also links emails of insurer orders that have since been lodged as jobs.
 *   Returns { attempted, linked, thread_linked, order_threads_linked, candidates_stored, admin, skipped, errors }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createClient } from '@/lib/supabase/server'
import { resolveCommunicationLink } from '@/lib/communications/resolve-link'
import { linkOrderThreadsToJob, linkThreadToJob } from '@/lib/communications/thread-link'

const DEFAULT_MAX = 50

type CommRow = {
  id: string
  subject: string | null
  body_text: string | null
  from_email: string | null
  thread_id: string | null
  created_at: string
}

// ── GET — dry-run count ───────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const userSession = await getUser()
  if (!userSession?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()

  const { count: total } = await supabase
    .from('communications')
    .select('*', { count: 'exact', head: true })
    .is('job_id', null)
    .eq('type', 'email')
    .eq('direction', 'inbound')

  // Eligible = not yet attempted (match_candidates is still null)
  const { count: eligible } = await supabase
    .from('communications')
    .select('*', { count: 'exact', head: true })
    .is('job_id', null)
    .is('match_candidates' as never, null)
    .eq('type', 'email')
    .eq('direction', 'inbound')

  return NextResponse.json({
    total: total ?? 0,
    eligible: eligible ?? 0,
    note: 'POST to process. Already-attempted rows (match_candidates set) are skipped.',
  })
}

// ── POST — process batch ──────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const userSession = await getUser()
  if (!userSession?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = userSession.tenant_id

  let max = DEFAULT_MAX
  let rematch = false
  let after: string | null = null
  try {
    const body = await req.json() as { max?: unknown; rematch?: unknown; after?: unknown }
    if (typeof body.max === 'number' && body.max > 0) max = Math.min(body.max, 200)
    rematch = body.rematch === true
    if (typeof body.after === 'string' && body.after) after = body.after
  } catch {
    // body is optional
  }

  const supabase = await createClient()

  // Eligible rows: unlinked inbound emails not yet attempted. With rematch,
  // previously attempted rows are retried too (e.g. after matcher improvements),
  // excluding insurer-order emails, which are linked when the order is lodged.
  let query = supabase
    .from('communications')
    .select('id, subject, body_text, from_email, thread_id, created_at')
    .is('job_id', null)
    .is('insurer_order_id' as never, null)
    .eq('type', 'email')
    .eq('direction', 'inbound')
  if (!rematch) query = query.is('match_candidates' as never, null)
  // Rematch pages through everything oldest-first; pass back next_after to continue
  if (after) query = query.gt('created_at', after)

  const { data: rows, error: fetchErr } = await query
    .order('created_at', { ascending: true })
    .limit(max)

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  const comms = (rows as CommRow[]) ?? []

  // Insurer-order emails whose order has since been lodged as a job: link the
  // email thread to that job (covers orders lodged before thread linking existed).
  // Orders still pending are left alone — they link when lodged.
  let order_threads_linked = 0
  const { data: orderComms } = await supabase
    .from('communications')
    .select('insurer_order_id, insurer_orders!inner(job_id)' as never)
    .is('job_id', null)
    .not('insurer_order_id' as never, 'is', null)
    .not('insurer_orders.job_id' as never, 'is', null)
  const lodged = new Map<string, string>()
  for (const row of (orderComms as unknown as { insurer_order_id: string; insurer_orders: { job_id: string } }[] | null) ?? []) {
    lodged.set(row.insurer_order_id, row.insurer_orders.job_id)
  }
  for (const [orderId, jobId] of lodged) {
    await linkOrderThreadsToJob(supabase, tenantId, orderId, jobId)
    order_threads_linked++
  }

  let linked = 0
  let thread_linked = 0
  let candidates_stored = 0
  let admin = 0
  let skipped = 0
  let errors = 0

  for (const comm of comms) {
    try {
      const link = await resolveCommunicationLink({
        db: supabase,
        tenantId,
        threadId: comm.thread_id,
        subject: comm.subject ?? '',
        body: comm.body_text ?? '',
        fromEmail: comm.from_email ?? '',
      })

      if (link.job_id) {
        await supabase
          .from('communications')
          .update({ job_id: link.job_id, match_candidates: null, source: link.source } as never)
          .eq('id', comm.id)
        thread_linked += await linkThreadToJob(supabase, tenantId, comm.thread_id, link.job_id)
        linked++
      } else if (link.match_candidates && link.match_candidates.length > 0) {
        await supabase
          .from('communications')
          .update({ match_candidates: link.match_candidates, source: link.source } as never)
          .eq('id', comm.id)
        candidates_stored++
      } else {
        // Mark as attempted with empty array so we skip it next run
        await supabase
          .from('communications')
          .update({ match_candidates: [], source: link.source } as never)
          .eq('id', comm.id)
        if (link.source === 'admin') admin++
        else skipped++
      }
    } catch (err) {
      console.error(`[match-backfill] error on comm ${comm.id}:`, err)
      errors++
    }
  }

  const { count: remaining } = await supabase
    .from('communications')
    .select('*', { count: 'exact', head: true })
    .is('job_id', null)
    .is('match_candidates' as never, null)
    .eq('type', 'email')
    .eq('direction', 'inbound')

  return NextResponse.json({
    attempted: comms.length,
    linked,
    thread_linked,
    order_threads_linked,
    candidates_stored,
    admin,
    skipped,
    errors,
    remaining: remaining ?? 0,
    // With rematch: pass as `after` to process the next page; null when done
    next_after: rematch && comms.length === max ? comms[comms.length - 1].created_at : null,
  })
}
