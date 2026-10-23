import { NextResponse } from 'next/server'
import { composeErrorResponse, mailAccess } from '@/lib/mail/access'
import { unsnooze } from '@/lib/mail/snooze'
import { getMailbox } from '@/lib/mail/sync'
import { permissionDenied } from '@/lib/permissions/http'

type Params = { params: Promise<{ id: string }> }

// DELETE /api/mail/snooze/[id] — unsnooze: back to the inbox now
export async function DELETE(_req: Request, { params }: Params): Promise<NextResponse> {
  const access = await mailAccess()
  if (access instanceof NextResponse) return access
  const denied = await permissionDenied(access.tenantId, access.userId, 'mail.organise')
  if (denied) return denied
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  try {
    const ok = await unsnooze(await getMailbox(access.tenantId), id)
    if (!ok) return NextResponse.json({ error: 'It isn\'t snoozed any more' }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return composeErrorResponse(err, 'unsnooze')
  }
}
