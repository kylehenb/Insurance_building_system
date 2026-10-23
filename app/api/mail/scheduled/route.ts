import { NextRequest, NextResponse } from 'next/server'
import { composeAccess, composeErrorResponse, mailAccess } from '@/lib/mail/access'
import { listScheduled, scheduleDraft } from '@/lib/mail/scheduled'
import { parseSendAt, spokenSendAt } from '@/lib/mail/schedule-rules'
import { getMailbox } from '@/lib/mail/sync'
import { permissionGate } from '@/lib/permissions/http'
import { recordActivity } from '@/lib/activity/log'

// GET /api/mail/scheduled — emails waiting to send (and ones that failed)
export async function GET(): Promise<NextResponse> {
  const access = await mailAccess()
  if (access instanceof NextResponse) return access
  try {
    return NextResponse.json(await listScheduled(await getMailbox(access.tenantId)))
  } catch (err) {
    return composeErrorResponse(err, 'list scheduled emails')
  }
}

// POST /api/mail/scheduled { draftId, sendAt } — send a saved draft later.
// sendAt: ISO with offset, or Perth wall clock ("2026-10-26T08:00").
export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await composeAccess()
  if (access instanceof NextResponse) return access

  let body: { draftId?: unknown; sendAt?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const draftId = typeof body.draftId === 'string' && /^[A-Za-z0-9_-]+$/.test(body.draftId) ? body.draftId : null
  const sendAt = typeof body.sendAt === 'string' ? parseSendAt(body.sendAt) : null
  if (!draftId) return NextResponse.json({ error: 'draftId is required' }, { status: 400 })
  if (!sendAt) return NextResponse.json({ error: 'sendAt must be a date and time' }, { status: 400 })

  const gate = await permissionGate(access.tenantId, access.userId, 'mail.send', { operation: 'mail.schedule', payload: { draftId, sendAt } })
  if (gate) return gate

  try {
    const scheduled = await scheduleDraft(await getMailbox(access.tenantId), access.userId, draftId, sendAt)
    await recordActivity({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'mail.send',
      summary: `Scheduled the email "${scheduled.subject ?? '(no subject)'}" to ${scheduled.recipients ?? 'unknown recipients'} for ${spokenSendAt(scheduled.send_at)}`,
      via: 'app',
    })
    return NextResponse.json(scheduled)
  } catch (err) {
    return composeErrorResponse(err, 'schedule the email')
  }
}
