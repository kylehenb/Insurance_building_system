import { NextResponse } from 'next/server'
import { composeAccess, composeErrorResponse } from '@/lib/mail/access'
import { discardDraft, openDraft } from '@/lib/mail/compose'
import { getMailbox } from '@/lib/mail/sync'

export const maxDuration = 60

type Params = { params: Promise<{ draftId: string }> }

const validId = (id: string) => /^[A-Za-z0-9_-]+$/.test(id)

// GET /api/mail/drafts/[draftId] — a saved draft, ready to edit
export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const access = await composeAccess()
  if (access instanceof NextResponse) return access
  const { draftId } = await params
  if (!validId(draftId)) return NextResponse.json({ error: 'Invalid draft id' }, { status: 400 })
  try {
    const mailbox = await getMailbox(access.tenantId)
    return NextResponse.json(await openDraft(mailbox, access.tenantId, draftId))
  } catch (err) {
    return composeErrorResponse(err, 'open the draft')
  }
}

// DELETE /api/mail/drafts/[draftId] — discard it (in Gmail too)
export async function DELETE(_req: Request, { params }: Params): Promise<NextResponse> {
  const access = await composeAccess()
  if (access instanceof NextResponse) return access
  const { draftId } = await params
  if (!validId(draftId)) return NextResponse.json({ error: 'Invalid draft id' }, { status: 400 })
  try {
    const mailbox = await getMailbox(access.tenantId)
    await discardDraft(mailbox, draftId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return composeErrorResponse(err, 'discard the draft')
  }
}
