import { NextRequest, NextResponse } from 'next/server'
import { runDailyFigures } from '@/lib/health/daily'
import { healthDb } from '@/lib/health/db'
import { withCronRun } from '@/lib/health/cron'

// The health check's daily figures (lib/health/daily.ts, tech spec §25.3):
// yesterday's, with tonight's reading of levels (open jobs, money owed,
// database size), and past days still missing. Vercel cron, 12:23am Perth.

export const maxDuration = 300

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

async function run(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = healthDb()
  if (!db) return NextResponse.json({ error: 'No database configured' }, { status: 500 })
  return NextResponse.json({ results: await runDailyFigures(db, { budgetMs: 240_000 }) })
}

export const GET = withCronRun('/api/health/daily', run)
