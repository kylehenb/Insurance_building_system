import { NextResponse } from 'next/server'
import { cardAccess, isUuid } from '@/lib/actions/access'
import { skipCard } from '@/lib/actions/cards'
import { mailDb } from '@/lib/mail/sync'

type Params = { params: Promise<{ id: string }> }

// POST /api/actions/[id]/skip — nothing to do; the card goes to Done
export async function POST(_req: Request, { params }: Params): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid card' }, { status: 400 })
  const ok = await skipCard(mailDb(), access.tenantId, id, access.userId)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'This card can\'t be skipped now' }, { status: 409 })
}
