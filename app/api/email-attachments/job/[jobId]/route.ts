import { NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { listJobAttachables } from '@/lib/mail/job-files'

type Params = { params: Promise<{ jobId: string }> }

// GET /api/email-attachments/job/[jobId] — the job's uploaded files and
// photos, to add to a document or work order email in Customise send. (The
// Mail page has its own, behind the mail permission.) Sending is what's
// permission-checked; this only lists the job's own files.
export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const user = await sessionUser()
  if (!user) return unauthorized()
  const { jobId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: 'Invalid job' }, { status: 400 })
  return NextResponse.json(await listJobAttachables(user.tenantId, jobId))
}
