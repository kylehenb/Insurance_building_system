import { NextRequest, NextResponse } from 'next/server'
import { cardAccess, isUuid } from '@/lib/actions/access'
import { CardError, withContext } from '@/lib/actions/cards'
import { cancelFollowUp, spokenDue, updateFollowUp } from '@/lib/actions/followups'
import { recordActivity } from '@/lib/activity/log'
import { mailDb } from '@/lib/mail/sync'

type Params = { params: Promise<{ id: string }> }

// POST /api/followups/[id] { dueAt?, note?, who? } — move a follow-up or change what it says.
// DELETE /api/followups/[id] — cancel it. Only while it's waiting for its date.

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid follow-up' }, { status: 400 })
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const changes: { dueAt?: string; note?: string; who?: string | null } = {}
  if (typeof body.dueAt === 'string') changes.dueAt = body.dueAt
  if (typeof body.note === 'string') changes.note = body.note
  if (typeof body.who === 'string' || body.who === null) changes.who = body.who as string | null
  const db = mailDb()
  try {
    const card = await updateFollowUp(db, access.tenantId, id, changes)
    await recordActivity({
      tenantId: access.tenantId, userId: access.userId, action: 'actions.review', jobId: card.job_id, via: 'app',
      summary: `Changed a follow-up (now ${spokenDue(card.due_at!)}): ${card.follow_up?.note ?? card.title}`,
    })
    return NextResponse.json({ followUp: (await withContext(db, access.tenantId, [card]))[0] })
  } catch (err) {
    if (err instanceof CardError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[followups] update failed:', err)
    return NextResponse.json({ error: 'Could not change the follow-up' }, { status: 502 })
  }
}

export async function DELETE(_req: Request, { params }: Params): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid follow-up' }, { status: 400 })
  const ok = await cancelFollowUp(mailDb(), access.tenantId, id, access.userId)
  if (!ok) return NextResponse.json({ error: 'That follow-up isn\'t waiting any more' }, { status: 409 })
  await recordActivity({ tenantId: access.tenantId, userId: access.userId, action: 'actions.review', summary: 'Cancelled a follow-up', via: 'app' })
  return NextResponse.json({ ok: true })
}
