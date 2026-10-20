import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createClient } from '@/lib/supabase/server'
import { linkThreadToJob, setThreadCategory } from '@/lib/communications/thread-link'

type Params = { params: Promise<{ id: string }> }

// PATCH /api/communications/[id]
// Supported bodies (exactly one field per request):
//   { job_id: string }       — manual job link from unlinked inbox, clears match_candidates.
//                              Links every unlinked message in the same Gmail thread too.
//   { source: 'admin' | 'unlinked' } — file an unlinked email as admin (not job related),
//                              or move it back. Applies to every unlinked message in its thread.
//   { read_at: string }      — mark as read (ISO timestamp); no-op if already read
//   { is_starred: boolean }  — toggle star
export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const userSession = await getUser()
  if (!userSession?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const supabase = await createClient()

  if ('job_id' in body) {
    if (typeof body.job_id !== 'string' || !body.job_id) {
      return NextResponse.json({ error: 'job_id must be a non-empty string' }, { status: 400 })
    }
    const { data: updated, error } = await supabase
      .from('communications')
      .update({ job_id: body.job_id, match_candidates: null } as never)
      .eq('id', id)
      .select('thread_id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const threadId = (updated as { thread_id: string | null } | null)?.thread_id ?? null
    const threadLinked = await linkThreadToJob(supabase, userSession.tenant_id, threadId, body.job_id)
    return NextResponse.json({ ok: true, thread_linked: threadLinked })
  }

  if ('source' in body) {
    if (body.source !== 'admin' && body.source !== 'unlinked') {
      return NextResponse.json({ error: "source must be 'admin' or 'unlinked'" }, { status: 400 })
    }
    // Only unlinked emails can be (re)categorised — a job-linked email stays on its job
    const { data: updated, error } = await supabase
      .from('communications')
      .update({ source: body.source } as never)
      .eq('id', id)
      .is('job_id', null)
      .select('thread_id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const threadId = (updated as { thread_id: string | null } | null)?.thread_id ?? null
    const threadUpdated = await setThreadCategory(supabase, userSession.tenant_id, threadId, body.source)
    return NextResponse.json({ ok: true, thread_updated: threadUpdated })
  }

  if ('read_at' in body) {
    if (typeof body.read_at !== 'string') {
      return NextResponse.json({ error: 'read_at must be an ISO timestamp string' }, { status: 400 })
    }
    // Use .is('read_at', null) so the update is idempotent — won't overwrite an earlier read_at
    const { error } = await supabase
      .from('communications')
      .update({ read_at: body.read_at } as never)
      .eq('id', id)
      .is('read_at', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if ('is_starred' in body) {
    if (typeof body.is_starred !== 'boolean') {
      return NextResponse.json({ error: 'is_starred must be a boolean' }, { status: 400 })
    }
    const { error } = await supabase
      .from('communications')
      .update({ is_starred: body.is_starred } as never)
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json(
    { error: 'No recognised field in body (expected: job_id | source | read_at | is_starred)' },
    { status: 400 }
  )
}
