import { NextRequest, NextResponse } from 'next/server'
import { composeErrorResponse, mailAccess } from '@/lib/mail/access'
import { listSnoozed, snoozeThreads } from '@/lib/mail/snooze'
import { parseSendAt, spokenSendAt } from '@/lib/mail/schedule-rules'
import { getMailbox } from '@/lib/mail/sync'
import { MAX_THREADS_PER_ACTION } from '@/lib/mail/actions'
import { permissionDenied } from '@/lib/permissions/http'
import { recordActivity } from '@/lib/activity/log'

export const maxDuration = 60

// GET /api/mail/snooze — snoozed conversations
export async function GET(): Promise<NextResponse> {
  const access = await mailAccess()
  if (access instanceof NextResponse) return access
  try {
    return NextResponse.json(await listSnoozed(await getMailbox(access.tenantId)))
  } catch (err) {
    return composeErrorResponse(err, 'list snoozed emails')
  }
}

// POST /api/mail/snooze { threadIds, until } — out of the inbox until then (Perth time or ISO)
export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await mailAccess()
  if (access instanceof NextResponse) return access
  const denied = await permissionDenied(access.tenantId, access.userId, 'mail.organise')
  if (denied) return denied

  let body: { threadIds?: unknown; until?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const ids = Array.isArray(body.threadIds)
    ? [...new Set(body.threadIds.filter((id): id is string => typeof id === 'string' && /^[0-9a-f]+$/i.test(id)))]
    : []
  const until = typeof body.until === 'string' ? parseSendAt(body.until) : null
  if (!ids.length || ids.length > MAX_THREADS_PER_ACTION) return NextResponse.json({ error: 'threadIds is required (at most 100)' }, { status: 400 })
  if (!until) return NextResponse.json({ error: 'until must be a date and time' }, { status: 400 })

  try {
    const result = await snoozeThreads(await getMailbox(access.tenantId), access.userId, ids, until)
    if (result.done.length) {
      const n = result.done.length
      await recordActivity({ tenantId: access.tenantId, userId: access.userId, action: 'mail.organise', summary: `${n} email conversation${n === 1 ? '' : 's'} snoozed until ${spokenSendAt(until)}`, via: 'app' })
    }
    if (!result.done.length) return NextResponse.json({ ...result, error: 'Gmail did not accept the change' }, { status: 502 })
    return NextResponse.json({ ...result, until })
  } catch (err) {
    return composeErrorResponse(err, 'snooze')
  }
}
