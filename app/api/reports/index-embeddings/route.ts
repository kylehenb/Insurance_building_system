import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { indexPendingReports } from '@/lib/reports/similar-reports'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Fingerprints locked reports that don't have one yet, for the automatic similar-report
// lookup used when writing new reports (lib/reports/similar-reports.ts). Lock actions
// fingerprint straight away; this is the safety net for anything missed (failed calls,
// other lock paths) and backfills existing reports, 100 per run.
const BATCH_SIZE = 100

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

// Vercel Cron triggers via GET — guard is the same CRON_SECRET Bearer check used by the other crons
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await indexPendingReports(createServiceClient(), BATCH_SIZE)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[index-embeddings] failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
