import { NextRequest, NextResponse } from 'next/server'
import { composeAccess, composeErrorResponse } from '@/lib/mail/access'
import { emptyCompose, type ComposeState } from '@/lib/mail/compose-rules'
import { saveDraft } from '@/lib/mail/compose'
import { getMailbox } from '@/lib/mail/sync'

export const maxDuration = 60

const str = (v: unknown, max = 100_000) => (typeof v === 'string' ? v.slice(0, max) : '')
const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null)

// POST /api/mail/drafts — save the email being written as a Gmail draft
// (creates it, or updates draftId). Body: ComposeState. Returns { draftId, threadId }.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await composeAccess()
  if (access instanceof NextResponse) return access

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const state: ComposeState = {
    ...emptyCompose(),
    draftId: strOrNull(body.draftId),
    threadId: strOrNull(body.threadId),
    mode: (body.mode as ComposeState['mode']) ?? 'new',
    quoteMessageId: strOrNull(body.quoteMessageId),
    rawQuote: strOrNull(body.rawQuote),
    inReplyTo: strOrNull(body.inReplyTo),
    references: strOrNull(body.references),
    to: str(body.to, 5000),
    cc: str(body.cc, 5000),
    bcc: str(body.bcc, 5000),
    subject: str(body.subject, 1000).replace(/[\r\n]+/g, ' '),
    body: str(body.body, 2_000_000),
    includeSignature: body.includeSignature !== false,
    attachments: Array.isArray(body.attachments) ? body.attachments.slice(0, 50) as ComposeState['attachments'] : [],
    jobId: typeof body.jobId === 'string' && /^[0-9a-f-]{36}$/i.test(body.jobId) ? body.jobId : null,
  }

  try {
    const mailbox = await getMailbox(access.tenantId)
    return NextResponse.json(await saveDraft(mailbox, access.tenantId, access.userId, state))
  } catch (err) {
    return composeErrorResponse(err, 'save the draft')
  }
}
