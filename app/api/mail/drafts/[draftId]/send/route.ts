import { NextResponse } from 'next/server'
import { composeAccess, composeErrorResponse } from '@/lib/mail/access'
import { describeDraft, sendDraft } from '@/lib/mail/compose'
import { getMailbox } from '@/lib/mail/sync'
import { permissionGate } from '@/lib/permissions/http'
import { recordActivity } from '@/lib/activity/log'

export const maxDuration = 60

type Params = { params: Promise<{ draftId: string }> }

// POST /api/mail/drafts/[draftId]/send — send a saved draft. At "needs
// approval" the draft stays in Gmail's drafts and is sent once approved.
// The webhook then files the sent copy on its job (lib/communications/record-sent.ts).
export async function POST(_req: Request, { params }: Params): Promise<NextResponse> {
  const access = await composeAccess()
  if (access instanceof NextResponse) return access
  const { draftId } = await params
  if (!/^[A-Za-z0-9_-]+$/.test(draftId)) return NextResponse.json({ error: 'Invalid draft id' }, { status: 400 })

  const gate = await permissionGate(access.tenantId, access.userId, 'mail.send', { operation: 'mail.send', payload: { draftId } })
  if (gate) return gate

  try {
    const mailbox = await getMailbox(access.tenantId)
    // Described before sending — afterwards the draft is gone
    const { to, subject } = await describeDraft(draftId)
    const sent = await sendDraft(mailbox, draftId)
    await recordActivity({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'mail.send',
      summary: `Sent the email "${subject}" to ${to} from the office mailbox`,
      via: 'app',
    })
    return NextResponse.json(sent)
  } catch (err) {
    return composeErrorResponse(err, 'send the email')
  }
}
