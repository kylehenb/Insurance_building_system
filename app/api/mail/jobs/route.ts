import { NextRequest, NextResponse } from 'next/server'
import { mailAccess } from '@/lib/mail/access'
import { searchJobs } from '@/lib/mail/job-context'

// GET /api/mail/jobs?q= — jobs to file a conversation on (number, claim, insured, address)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const access = await mailAccess()
  if (access instanceof NextResponse) return access
  return NextResponse.json(await searchJobs(access.tenantId, req.nextUrl.searchParams.get('q') ?? ''))
}
