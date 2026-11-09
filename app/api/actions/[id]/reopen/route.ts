import { NextResponse } from 'next/server'
import { cardAccess, isUuid } from '@/lib/actions/access'
import { CardError, reopenCard, withContext } from '@/lib/actions/cards'
import { recordActivity } from '@/lib/activity/log'
import { mailDb } from '@/lib/mail/sync'

type Params = { params: Promise<{ id: string }> }

// POST /api/actions/[id]/reopen — puts a done, skipped or no-action card back
// on the to-do list ("Put back" — above all on a card IRC closed as done
// because the job moved on, which is learned from: lib/actions/recheck.ts)
export async function POST(_req: Request, { params }: Params): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid card' }, { status: 400 })
  const db = mailDb()
  try {
    const card = await reopenCard(db, access.tenantId, id, access.userId)
    await recordActivity({ tenantId: access.tenantId, userId: access.userId, action: 'actions.review', summary: `Put "${card.title}" back on the action cards`, jobId: card.job_id, via: 'app', service: db as never })
    return NextResponse.json({ card: (await withContext(db, access.tenantId, [card]))[0] })
  } catch (err) {
    if (err instanceof CardError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
