import { NextRequest, NextResponse } from 'next/server'
import { cardAccess, isUuid } from '@/lib/actions/access'
import { teachFromCard } from '@/lib/actions/teach'
import { MAX_SAID } from '@/lib/learning/debrief'
import { mailDb } from '@/lib/mail/sync'

type Params = { params: Promise<{ id: string }> }

// POST /api/actions/[id]/teach { comment } — what the office says about a card
// (confirming, editing, skipping it, or any time), debriefed into takeaways
// that work from the next card on (tech spec §24.8). Returns them, to show.
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid card' }, { status: 400 })
  const body = await req.json().catch(() => null) as { comment?: unknown } | null
  const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, MAX_SAID) : ''
  if (!comment) return NextResponse.json({ error: 'Say what IRC should take from it' }, { status: 400 })
  const takeaways = await teachFromCard(mailDb(), access.tenantId, access.userId, id, comment)
  return NextResponse.json({ takeaways })
}
