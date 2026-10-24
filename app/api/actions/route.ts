import { NextRequest, NextResponse } from 'next/server'
import { cardAccess, isUuid } from '@/lib/actions/access'
import { countPending, isCategory, listCards, withContext, type CardView } from '@/lib/actions/cards'
import { mailDb } from '@/lib/mail/sync'

// GET /api/actions?view=pending|done&category=&job= — action cards, with their
// job and conversation; category: invoice | attend_submit | other (the star
// symbol); job: one job's cards (the job page)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const access = await cardAccess(false)
  if (access instanceof NextResponse) return access
  const params = req.nextUrl.searchParams
  const view: CardView = params.get('view') === 'done' ? 'done' : 'pending'
  const category = params.get('category')
  const job = params.get('job')
  const db = mailDb()
  const [cards, pending] = await Promise.all([
    listCards(db, access.tenantId, view, { category: isCategory(category) ? category : null, jobId: isUuid(job) ? job : null }),
    countPending(db, access.tenantId),
  ])
  return NextResponse.json({ cards: await withContext(db, access.tenantId, cards), pending })
}
