import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string }> }

// PATCH /api/communications/[id]
// Body: { job_id: string }
// Sets job_id on the communication row (manual link from unlinked inbox).
// Clears match_candidates once linked since they're no longer needed.
export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const userSession = await getUser()
  if (!userSession?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let jobId: string
  try {
    const body = await req.json() as { job_id?: unknown }
    if (typeof body.job_id !== 'string' || !body.job_id) {
      return NextResponse.json({ error: 'job_id is required' }, { status: 400 })
    }
    jobId = body.job_id
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const supabase = await createClient()

  // RLS ensures tenant isolation — no manual tenant_id filter needed
  const { error } = await supabase
    .from('communications')
    .update({ job_id: jobId, match_candidates: null } as never)
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
