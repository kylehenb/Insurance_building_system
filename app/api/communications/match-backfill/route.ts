/**
 * Retroactive job-matching for communications rows that have job_id: null.
 *
 * GET  /api/communications/match-backfill
 *   Dry-run: returns { total, eligible } — no writes.
 *   eligible = rows with job_id IS NULL that haven't been matched yet.
 *
 * POST /api/communications/match-backfill
 *   Body (optional): { max?: number }  — default 50
 *   Processes up to `max` unlinked rows oldest-first.
 *   Safe to re-run: rows already attempted (match_candidates set OR
 *   job_id set) are skipped unless re-run is forced.
 *   Returns { attempted, linked, candidates_stored, skipped, errors }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createClient } from '@/lib/supabase/server'
import { matchJob } from '@/lib/communications/match-job'

const DEFAULT_MAX = 50

type CommRow = {
  id: string
  subject: string | null
  body_text: string | null
  from_email: string | null
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
  try {
    const body = await req.json() as { max?: unknown }
    if (typeof body.max === 'number' && body.max > 0) max = Math.min(body.max, 200)
  } catch {
    // body is optional
  }

  const supabase = await createClient()

  // Fetch eligible rows: unlinked, not yet attempted, inbound emails only
  const { data: rows, error: fetchErr } = await supabase
    .from('communications')
    .select('id, subject, body_text, from_email')
    .is('job_id', null)
    .is('match_candidates' as never, null)
    .eq('type', 'email')
    .eq('direction', 'inbound')
    .order('created_at', { ascending: true })
    .limit(max)

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  const comms = (rows as CommRow[]) ?? []

  let linked = 0
  let candidates_stored = 0
  let skipped = 0
  let errors = 0

  for (const comm of comms) {
    try {
      const match = await matchJob({
        subject: comm.subject ?? '',
        body: comm.body_text ?? '',
        from_email: comm.from_email ?? '',
        tenant_id: tenantId,
      })

      if (match.job_id && match.confidence === 'high') {
        await supabase
          .from('communications')
          .update({ job_id: match.job_id, match_candidates: null } as never)
          .eq('id', comm.id)
        linked++
      } else if (match.candidates.length > 0) {
        await supabase
          .from('communications')
          .update({ match_candidates: match.candidates } as never)
          .eq('id', comm.id)
        candidates_stored++
      } else {
        // Mark as attempted with empty array so we skip it next run
        await supabase
          .from('communications')
          .update({ match_candidates: [] } as never)
          .eq('id', comm.id)
        skipped++
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
    candidates_stored,
    skipped,
    errors,
    remaining: remaining ?? 0,
  })
}
