import { NextRequest, NextResponse } from 'next/server'
import { sendDueEmails } from '@/lib/mail/scheduled'
import { wakeSnoozed } from '@/lib/mail/snooze'

// Sends scheduled emails that are due (lib/mail/scheduled.ts) and brings
// snoozed conversations back to the inbox (lib/mail/snooze.ts). Vercel cron, every minute.

export const maxDuration = 120

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [sent, snoozes] = await Promise.all([sendDueEmails(), wakeSnoozed()])
  return NextResponse.json({ ...sent, ...snoozes })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return GET(req)
}
