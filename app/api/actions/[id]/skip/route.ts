import { NextResponse } from 'next/server'
import { cardAccess, isUuid } from '@/lib/actions/access'
import { getCard, skipCard } from '@/lib/actions/cards'
import { isSkipReason } from '@/lib/actions/learning'
import { discardStepDrafts } from '@/lib/actions/steps'
import { mailDb } from '@/lib/mail/sync'

type Params = { params: Promise<{ id: string }> }

// POST /api/actions/[id]/skip { reason? } — nothing to do; the card goes to Done.
// reason (not_now / not_needed / wrong) tells the learning why (§24.7)
export async function POST(req: Request, { params }: Params): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid card' }, { status: 400 })
  const db = mailDb()
  const body = await req.json().catch(() => null) as { reason?: unknown } | null
  const ok = await skipCard(db, access.tenantId, id, access.userId, isSkipReason(body?.reason) ? body.reason : undefined)
  // Its emails won't be sent: their drafts go too
  const card = ok ? await getCard(db, access.tenantId, id) : null
  if (card) await discardStepDrafts(card, db)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'This card can\'t be skipped now' }, { status: 409 })
}
