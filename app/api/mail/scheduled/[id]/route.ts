import { NextResponse } from 'next/server'
import { composeAccess, composeErrorResponse } from '@/lib/mail/access'
import { cancelScheduled } from '@/lib/mail/scheduled'
import { getMailbox } from '@/lib/mail/sync'

type Params = { params: Promise<{ id: string }> }

// DELETE /api/mail/scheduled/[id] — take it off the schedule; it stays a draft
export async function DELETE(_req: Request, { params }: Params): Promise<NextResponse> {
  const access = await composeAccess()
  if (access instanceof NextResponse) return access
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  try {
    const cancelled = await cancelScheduled(await getMailbox(access.tenantId), id)
    if (!cancelled) return NextResponse.json({ error: 'That email isn\'t scheduled any more — it may be sending now' }, { status: 409 })
    return NextResponse.json(cancelled)
  } catch (err) {
    return composeErrorResponse(err, 'cancel the scheduled email')
  }
}
