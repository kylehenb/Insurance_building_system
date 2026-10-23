import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { listApprovals } from '@/lib/approvals/service'

// The approval queue (lib/approvals).
// GET ?status=pending|all&jobId=… → requests the signed-in user can decide or
// asked for (pending), plus recent outcomes when status=all (the default)
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getUser()
  const userId = user?.session?.user.id
  if (!user?.tenant_id || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = request.nextUrl.searchParams
  try {
    const approvals = await listApprovals(user.tenant_id, userId, {
      status: params.get('status') === 'pending' ? 'pending' : 'all',
      jobId: params.get('jobId') ?? undefined,
    })
    return NextResponse.json({ approvals })
  } catch (err) {
    console.error('[approvals] list failed:', err)
    return NextResponse.json({ error: 'Could not load approvals' }, { status: 500 })
  }
}
