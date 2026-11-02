import { NextRequest, NextResponse } from 'next/server'
import { runHealthWatch } from '@/lib/health/watch'
import { healthDb } from '@/lib/health/db'
import { withCronRun } from '@/lib/health/cron'

// The health watcher (lib/health/watch.ts, tech spec §25): scheduled jobs
// that stopped or keep failing, AI failing, error spikes, AI spend — emailed
// to the admins as they start, daily while they last, and when they clear.
// Vercel cron, every 10 minutes.

export const maxDuration = 60

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

async function run(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = healthDb()
  if (!db) return NextResponse.json({ error: 'No database configured' }, { status: 500 })
  return NextResponse.json(await runHealthWatch(db))
}

export const GET = withCronRun('/api/health/watch', run)
