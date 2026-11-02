import { NextRequest, NextResponse } from 'next/server'
import { reviewAllJobs } from '@/lib/jobs/review'
import { mailDb } from '@/lib/mail/sync'
import { withCronRun } from '@/lib/health/cron'

// The morning job review (lib/jobs/review.ts, tech spec §23.14): open jobs
// changed since last read (and weekly, those gone quiet) are read and their
// dated checks planned; then old records nothing reads are let go. Vercel
// cron, 6:37am Perth every day.

export const maxDuration = 300

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

async function runGet(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const results = await reviewAllJobs(mailDb(), { budgetMs: 270_000 })
  return NextResponse.json({
    reviewed: results.length,
    checks: results.reduce((n, r) => n + r.checks.length, 0),
    errors: results.filter(r => r.error).map(r => `${r.job}: ${r.error}`),
  })
}

// Each run is recorded for the health watcher (tech spec §25)
export const GET = withCronRun('/api/jobs/review', runGet)
