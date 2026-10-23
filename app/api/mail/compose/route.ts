import { NextRequest, NextResponse } from 'next/server'
import { composeAccess, composeErrorResponse } from '@/lib/mail/access'
import { isComposeMode } from '@/lib/mail/compose-rules'
import { startCompose } from '@/lib/mail/compose'
import { getMailbox } from '@/lib/mail/sync'

// GET /api/mail/compose?mode=reply|reply_all|forward|new&message=<gmail message id>
// A new email, reply or forward, ready to edit (recipients, subject, quote).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const access = await composeAccess()
  if (access instanceof NextResponse) return access

  const mode = req.nextUrl.searchParams.get('mode') ?? 'new'
  const messageId = req.nextUrl.searchParams.get('message')
  if (!isComposeMode(mode)) return NextResponse.json({ error: 'Unknown mode' }, { status: 400 })
  if (mode !== 'new' && !/^[0-9a-f]+$/i.test(messageId ?? '')) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  try {
    const mailbox = await getMailbox(access.tenantId)
    return NextResponse.json(await startCompose(mailbox, mode, messageId))
  } catch (err) {
    return composeErrorResponse(err, 'start the email')
  }
}
