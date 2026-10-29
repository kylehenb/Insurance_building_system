import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { listLessons } from '@/lib/learning/lessons'
import { lastReviews } from '@/lib/learning/review'
import { learningStats } from '@/lib/learning/stats'
import { permissionLevel } from '@/lib/permissions/resolve'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/learning?days= — "What the AI has learned" (tech spec §24.6): how
// often its proposals are confirmed untouched, the lessons it has (with their
// track record), and the last nightly reviews. Changing a lesson needs
// settings.edit (canChange).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get('days')) || 30))
  const db = createServiceClient()
  try {
    const [lessons, stats, reviews, level] = await Promise.all([
      listLessons(db, me.tenantId),
      learningStats(db, me.tenantId, { days }),
      lastReviews(db, me.tenantId),
      permissionLevel(me.tenantId, me.userId, 'settings.edit', db),
    ])
    return NextResponse.json({ days, lessons, stats, reviews, canChange: level === 'allowed' })
  } catch (err) {
    console.error('[learning] page data failed:', err)
    return NextResponse.json({ error: 'Could not load what the AI has learned' }, { status: 500 })
  }
}
