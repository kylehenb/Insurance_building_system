import { NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { markJobOpen } from '@/lib/actions/recheck'
import { isUuid } from '@/lib/actions/access'
import { mailDb } from '@/lib/mail/sync'

type Params = { params: Promise<{ jobId: string }> }

// POST /api/jobs/[jobId]/presence — the job page says it's open, every minute
// while it's on screen. Checking the job's action cards waits until nobody
// has it open (lib/actions/recheck.ts), so someone part-way through a job
// isn't checked on after every change. Records nothing else.
export async function POST(_req: Request, { params }: Params): Promise<NextResponse> {
  const user = await sessionUser()
  if (!user) return unauthorized()
  const { jobId } = await params
  if (!isUuid(jobId)) return NextResponse.json({ error: 'Invalid job' }, { status: 400 })
  const db = mailDb()
  const { data: job } = await db.from('jobs').select('id').eq('tenant_id', user.tenantId).eq('id', jobId).maybeSingle()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  await markJobOpen(db, user.tenantId, jobId, user.userId)
  return NextResponse.json({ ok: true })
}
