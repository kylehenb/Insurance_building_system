import { NextResponse } from 'next/server'
import { cardAccess } from '@/lib/actions/access'
import { cardForThread, withContext } from '@/lib/actions/cards'
import { mailDb } from '@/lib/mail/sync'

type Params = { params: Promise<{ threadId: string }> }

// GET /api/actions/thread/[threadId] — the card for one conversation (null if none)
export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const access = await cardAccess(false)
  if (access instanceof NextResponse) return access
  const { threadId } = await params
  if (!/^[0-9a-f]+$/i.test(threadId)) return NextResponse.json({ error: 'Invalid conversation' }, { status: 400 })
  const db = mailDb()
  const card = await cardForThread(db, access.tenantId, threadId)
  return NextResponse.json({ card: card ? (await withContext(db, access.tenantId, [card]))[0] : null })
}
