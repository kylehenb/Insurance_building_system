import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { reviewAll } from '@/lib/learning/review'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// The learning module's nightly review (tech spec §24.5): for each company
// and AI feature with new decisions, a stronger model keeps the lessons —
// adds, backs, narrows and retires them from what the office actually did.

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

// Vercel Cron triggers via GET — guard is the same CRON_SECRET Bearer check used by the other crons
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ ok: true, skipped: 'No ANTHROPIC_API_KEY' })
  try {
    const results = await reviewAll(createServiceClient())
    return NextResponse.json({ ok: true, results })
  } catch (err) {
    console.error('[learning-review] failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
