import { NextRequest, NextResponse } from 'next/server'
import { cardAccess } from '@/lib/actions/access'
import { countPending, listCards, withContext, type CardView } from '@/lib/actions/cards'
import { mailDb } from '@/lib/mail/sync'

// GET /api/actions?view=pending|snoozed|done — action cards, with their job and conversation
export async function GET(req: NextRequest): Promise<NextResponse> {
  const access = await cardAccess(false)
  if (access instanceof NextResponse) return access
  const v = req.nextUrl.searchParams.get('view')
  const view: CardView = v === 'snoozed' || v === 'done' ? v : 'pending'
  const db = mailDb()
  const [cards, pending] = await Promise.all([listCards(db, access.tenantId, view), countPending(db, access.tenantId)])
  return NextResponse.json({ cards: await withContext(db, access.tenantId, cards), pending })
}
