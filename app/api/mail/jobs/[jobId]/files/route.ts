import { NextResponse } from 'next/server'
import { mailAccess } from '@/lib/mail/access'
import { listJobAttachables } from '@/lib/mail/job-files'

type Params = { params: Promise<{ jobId: string }> }

// GET /api/mail/jobs/[jobId]/files — the job's uploaded files and photos, to attach to an email
export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const access = await mailAccess()
  if (access instanceof NextResponse) return access
  const { jobId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: 'Invalid job' }, { status: 400 })
  return NextResponse.json(await listJobAttachables(access.tenantId, jobId))
}
