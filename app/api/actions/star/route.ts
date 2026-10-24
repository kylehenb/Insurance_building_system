import { NextRequest, NextResponse } from 'next/server'
import { cardAccess } from '@/lib/actions/access'
import { CATEGORIES, isCategory, starThread, type CardCategory } from '@/lib/actions/cards'
import { recordActivity } from '@/lib/activity/log'
import { mailDb } from '@/lib/mail/sync'

// POST /api/actions/star { threadId, category } — the inbox's star button.
// category invoice | attend_submit | other stars the conversation (or changes
// its symbol); null takes the star off.
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
  if (body.category !== null && !isCategory(body.category)) return NextResponse.json({ error: 'Unknown star' }, { status: 400 })
  const category = body.category === null ? null : (body.category as CardCategory)

  try {
    const star = await starThread(mailDb(), access.tenantId, threadId, category, access.userId)
    await recordActivity({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'actions.review',
      summary: star ? `Starred "${star.title}" — ${CATEGORIES.find(c => c.key === star.category)!.label}` : 'Took the star off an email',
      via: 'app',
    })
    return NextResponse.json({ star })
  } catch (err) {
    console.error('[actions] star failed:', err)
    return NextResponse.json({ error: 'Could not star the email' }, { status: 502 })
  }
}
