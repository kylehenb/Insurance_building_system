import { NextRequest, NextResponse } from 'next/server'
import { cardAccess, isUuid } from '@/lib/actions/access'
import { countPending, isCategory, listCards, pileCounts, withContext, type CardView } from '@/lib/actions/cards'
import { mailDb } from '@/lib/mail/sync'

// GET /api/actions?view=pending|done&category=&job= — action cards, with their
// job and conversation; category: one pile (new_work | insurer | trades |
// reports_quotes | money); job: one job's cards (the job page). piles: how
// many need the office in each pile.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const access = await cardAccess(false)
  if (access instanceof NextResponse) return access
  const params = req.nextUrl.searchParams
  const view: CardView = params.get('view') === 'done' ? 'done' : 'pending'
  const category = params.get('category')
  const job = params.get('job')
  const db = mailDb()
  const [cards, pending, piles] = await Promise.all([
    listCards(db, access.tenantId, view, { category: isCategory(category) ? category : null, jobId: isUuid(job) ? job : null }),
    countPending(db, access.tenantId),
    pileCounts(db, access.tenantId),
  ])
  return NextResponse.json({ cards: await withContext(db, access.tenantId, cards), pending, piles })
}
