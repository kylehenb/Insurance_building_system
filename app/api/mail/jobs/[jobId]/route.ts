import { NextResponse } from 'next/server'
import { mailAccess } from '@/lib/mail/access'
import { jobPanel } from '@/lib/mail/job-context'

type Params = { params: Promise<{ jobId: string }> }

// GET /api/mail/jobs/[jobId] — the job beside a conversation: details, stage, contacts, documents
export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const access = await mailAccess()
  if (access instanceof NextResponse) return access
  const { jobId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: 'Invalid job' }, { status: 400 })
  const panel = await jobPanel(access.tenantId, jobId)
  if (!panel) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  return NextResponse.json(panel)
}
