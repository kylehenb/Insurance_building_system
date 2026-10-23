import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { listActivity } from '@/lib/activity/log'

// The who-did-what log (lib/activity). GET ?userId=&jobId=&days=
// Everyone's for those who may manage users; otherwise your own.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getUser()
  const userId = user?.session?.user.id
  if (!user?.tenant_id || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const params = request.nextUrl.searchParams
  try {
    return NextResponse.json(await listActivity(user.tenant_id, userId, {
      userId: params.get('userId') || undefined,
      jobId: params.get('jobId') || undefined,
      days: Number(params.get('days')) || undefined,
    }))
  } catch (err) {
    console.error('[activity] list failed:', err)
    return NextResponse.json({ error: 'Could not load activity' }, { status: 500 })
  }
}
