import { NextRequest, NextResponse } from 'next/server'
import { mailAccess } from '@/lib/mail/access'
import { ACTION_DONE, isMailAction } from '@/lib/mail/folders'
import { applyThreadAction, MAX_THREADS_PER_ACTION } from '@/lib/mail/actions'
import { getMailbox } from '@/lib/mail/sync'
import { permissionDenied } from '@/lib/permissions/http'
import { recordActivity } from '@/lib/activity/log'

export const maxDuration = 60

// POST /api/mail/threads/actions
//   { threadIds: string[], action: archive | inbox | trash | untrash | spam | not_spam | read | unread, auto?: boolean }
// auto: the page marking a conversation read because it was opened — not logged.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await mailAccess()
  if (access instanceof NextResponse) return access
  const denied = await permissionDenied(access.tenantId, access.userId, 'mail.organise')
  if (denied) return denied

  let body: { threadIds?: unknown; action?: unknown; auto?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { action } = body
  const threadIds = Array.isArray(body.threadIds)
    ? [...new Set(body.threadIds.filter((id): id is string => typeof id === 'string' && /^[0-9a-f]+$/i.test(id)))]
    : []
  if (!isMailAction(action)) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  if (threadIds.length === 0) return NextResponse.json({ error: 'threadIds is required' }, { status: 400 })
  if (threadIds.length > MAX_THREADS_PER_ACTION) {
    return NextResponse.json({ error: `At most ${MAX_THREADS_PER_ACTION} conversations at a time` }, { status: 400 })
  }

  try {
    const mailbox = await getMailbox(access.tenantId)
    const result = await applyThreadAction(mailbox, threadIds, action)

    if (body.auto !== true && result.done.length > 0) {
      const n = result.done.length
      await recordActivity({
        tenantId: access.tenantId,
        userId: access.userId,
        action: 'mail.organise',
        summary: `${n} email conversation${n === 1 ? '' : 's'} ${ACTION_DONE[action]}`,
        via: 'app',
        outcome: result.failed.length ? 'failed' : 'done',
        detail: result.failed.length ? `${result.failed.length} could not be changed in Gmail` : null,
      })
    }

    if (result.done.length === 0) {
      return NextResponse.json({ ...result, error: 'Gmail did not accept the change' }, { status: 502 })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[mail] action failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not change the mailbox' }, { status: 502 })
  }
}
