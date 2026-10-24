import { NextRequest, NextResponse } from 'next/server'
import { composeAccess, composeErrorResponse } from '@/lib/mail/access'
import { attachJobFile } from '@/lib/mail/job-files'

export const maxDuration = 60

const UUID = /^[0-9a-f-]{36}$/i

// POST /api/mail/job-files { jobId, source: 'file' | 'photo', id } — one of a
// job's files or photos as an attachment for the email being written (a copy
// kept with the draft's other uploads).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await composeAccess()
  if (access instanceof NextResponse) return access

  let body: { jobId?: unknown; source?: unknown; id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { jobId, source, id } = body
  if (typeof jobId !== 'string' || !UUID.test(jobId) || typeof id !== 'string' || !UUID.test(id) || (source !== 'file' && source !== 'photo')) {
    return NextResponse.json({ error: 'jobId, source and id are required' }, { status: 400 })
  }
  try {
    return NextResponse.json({ attachment: await attachJobFile(access.tenantId, jobId, source, id) })
  } catch (err) {
    return composeErrorResponse(err, 'attach the file')
  }
}
