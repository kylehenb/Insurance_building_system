import { NextRequest, NextResponse } from 'next/server'
import { sendSigningReminders } from '@/lib/signing/reminders'

// Daily Vercel Cron (vercel.json): reminds signers who haven't signed after
// 7 days, up to 3 reminders, skipping requests with reminders turned off.
// Guarded by the same CRON_SECRET Bearer check as the other crons.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await sendSigningReminders()
    console.log(`[signing/reminders] checked ${result.checked}, reminded ${result.reminded.length}, failed ${result.failed.length}`)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[signing/reminders] failed:', err)
    return NextResponse.json({ error: 'Reminder run failed' }, { status: 500 })
  }
}
