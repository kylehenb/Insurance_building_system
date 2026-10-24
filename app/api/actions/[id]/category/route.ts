import { NextRequest, NextResponse } from 'next/server'
import { cardAccess, isUuid } from '@/lib/actions/access'
import { isCategory, setCardCategory } from '@/lib/actions/cards'
import { mailDb } from '@/lib/mail/sync'

type Params = { params: Promise<{ id: string }> }

// POST /api/actions/[id]/category { category } — change a card's star symbol
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid card' }, { status: 400 })
  let body: { category?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!isCategory(body.category)) return NextResponse.json({ error: 'Unknown star' }, { status: 400 })
  const ok = await setCardCategory(mailDb(), access.tenantId, id, body.category, access.userId)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'This card is already dealt with' }, { status: 409 })
}
