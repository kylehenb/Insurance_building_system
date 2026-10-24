import { NextRequest, NextResponse } from 'next/server'
import { sendDueEmails } from '@/lib/mail/scheduled'
import { wakeSnoozed } from '@/lib/mail/snooze'
import { drainCardQueue } from '@/lib/actions/propose'

// Sends scheduled emails that are due (lib/mail/scheduled.ts) and brings
// snoozed conversations back to the inbox (lib/mail/snooze.ts), and makes
// queued action cards (lib/actions/propose.ts). Vercel cron, every minute.

export const maxDuration = 300

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [sent, snoozes, cards] = await Promise.all([sendDueEmails(), wakeSnoozed(), drainCardQueue({ budgetMs: 200_000 })])
  return NextResponse.json({ ...sent, ...snoozes, cards: cards.made })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return GET(req)
}
