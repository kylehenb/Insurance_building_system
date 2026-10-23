import { NextResponse } from 'next/server'
import { mailAccess } from '@/lib/mail/access'
import { getThreadDetail } from '@/lib/mail/list'
import { getMailbox } from '@/lib/mail/sync'

type Params = { params: Promise<{ threadId: string }> }

// GET /api/mail/threads/[threadId] — one conversation, fetched from Gmail
export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const access = await mailAccess()
  if (access instanceof NextResponse) return access

  const { threadId } = await params
  if (!/^[0-9a-f]+$/i.test(threadId)) {
    return NextResponse.json({ error: 'Invalid thread id' }, { status: 400 })
  }

  try {
    const mailbox = await getMailbox(access.tenantId)
    const detail = await getThreadDetail(mailbox, threadId)
    if (!detail) return NextResponse.json({ error: 'This conversation no longer exists' }, { status: 404 })
    return NextResponse.json(detail)
  } catch (err) {
    console.error('[mail] thread fetch failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not load conversation' }, { status: 502 })
  }
}
