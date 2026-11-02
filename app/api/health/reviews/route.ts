import { NextRequest, NextResponse } from 'next/server'
import { runReviews } from '@/lib/health/review'
import { healthDb } from '@/lib/health/db'
import { withCronRun } from '@/lib/health/cron'

// The health check's written reviews (lib/health/review.ts, tech spec
// §25.4): each finished week, month, quarter and year not yet reviewed (the
// last 4 of each), once its figures are in. Vercel cron, 1:13am Perth, after
// the daily figures.

export const maxDuration = 300

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

async function run(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ ok: true, skipped: 'No ANTHROPIC_API_KEY' })
  const db = healthDb()
  if (!db) return NextResponse.json({ error: 'No database configured' }, { status: 500 })
  const results = await runReviews(db, { budgetMs: 200_000 })
  return NextResponse.json({ results, errors: results.flatMap(r => r.failed.map(l => `${l}: review failed`)) })
}

export const GET = withCronRun('/api/health/reviews', run)
