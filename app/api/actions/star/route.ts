import { NextRequest, NextResponse } from 'next/server'
import { cardAccess } from '@/lib/actions/access'
import { AUTO_PILE, isCategory, pileOf, starThread, type CardCategory } from '@/lib/actions/cards'
import { recordActivity } from '@/lib/activity/log'
import { mailDb } from '@/lib/mail/sync'

// POST /api/actions/star { threadId, category } — the inbox's pile button.
// category new_work | insurer | trades | reports_quotes | money puts the
// conversation on the list in that pile (or moves it); 'auto' puts it on the
// list for the AI to pick the pile; null takes it off the list.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  let body: { threadId?: unknown; category?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const threadId = typeof body.threadId === 'string' && /^[0-9a-f]+$/i.test(body.threadId) ? body.threadId : null
  if (!threadId) return NextResponse.json({ error: 'Invalid conversation' }, { status: 400 })
  if (body.category !== null && body.category !== AUTO_PILE && !isCategory(body.category)) return NextResponse.json({ error: 'Unknown pile' }, { status: 400 })
  const category = body.category === null ? null : (body.category as CardCategory | typeof AUTO_PILE)

  try {
    const star = await starThread(mailDb(), access.tenantId, threadId, category, access.userId)
    await recordActivity({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'actions.review',
      summary: star ? `Put "${star.title}" on the list${category === AUTO_PILE ? '' : ` — ${pileOf(star.category)?.label}`}` : 'Took an email off the list',
      via: 'app',
    })
    return NextResponse.json({ star })
  } catch (err) {
    console.error('[actions] star failed:', err)
    return NextResponse.json({ error: 'Could not put the email on the list' }, { status: 502 })
  }
}
