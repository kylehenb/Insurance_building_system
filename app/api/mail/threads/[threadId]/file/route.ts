import { NextRequest, NextResponse } from 'next/server'
import { mailAccess } from '@/lib/mail/access'
import { FileThreadError, fileThread } from '@/lib/mail/file-thread'
import { getMailbox, mailDb } from '@/lib/mail/sync'
import { permissionDenied } from '@/lib/permissions/http'
import { recordActivity } from '@/lib/activity/log'

type Params = { params: Promise<{ threadId: string }> }

export const maxDuration = 60

// POST /api/mail/threads/[threadId]/file
//   { jobId }                      — file the conversation on a job (moves it from another job too)
//   { filing: 'admin' | 'to_file' } — not job related / back to "to file"
// The unlinked inbox's filing (orders.manage: "file emails on jobs").
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const access = await mailAccess()
  if (access instanceof NextResponse) return access
  const denied = await permissionDenied(access.tenantId, access.userId, 'orders.manage')
  if (denied) return denied

  const { threadId } = await params
  if (!/^[0-9a-f]+$/i.test(threadId)) return NextResponse.json({ error: 'Invalid conversation' }, { status: 400 })
  let body: { jobId?: unknown; filing?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const jobId = typeof body.jobId === 'string' && /^[0-9a-f-]{36}$/i.test(body.jobId) ? body.jobId : null
  const filing = body.filing === 'admin' || body.filing === 'to_file' ? body.filing : null
  if (!jobId && !filing) return NextResponse.json({ error: 'Give jobId or filing' }, { status: 400 })

  try {
    const mailbox = await getMailbox(access.tenantId)
    const result = await fileThread(mailbox, threadId, jobId ? { jobId } : { filing: filing! })
    const { data: thread } = await mailDb()
      .from('mail_threads').select('subject').eq('mailbox_id', mailbox.id).eq('gmail_thread_id', threadId).maybeSingle()
    const subject = (thread as { subject: string | null } | null)?.subject ?? '(no subject)'
    await recordActivity({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'orders.manage',
      summary: jobId ? `Filed the email "${subject}" on a job` : filing === 'admin' ? `Filed the email "${subject}" as admin` : `Moved the email "${subject}" back to To file`,
      jobId,
      via: 'app',
    })
    return NextResponse.json({ filing: result })
  } catch (err) {
    if (err instanceof FileThreadError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[mail] filing failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not file the email' }, { status: 502 })
  }
}
