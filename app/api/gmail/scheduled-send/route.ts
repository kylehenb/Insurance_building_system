import { NextRequest, NextResponse } from 'next/server'
import { sendDueEmails } from '@/lib/mail/scheduled'
import { drainCardQueue } from '@/lib/actions/propose'
import { releaseDueFollowUps } from '@/lib/actions/followups'
import { mailDb } from '@/lib/mail/sync'

// Sends scheduled emails that are due (lib/mail/scheduled.ts), puts
// follow-ups that are due on the list (lib/actions/followups.ts) and makes
// queued action cards (lib/actions/propose.ts). Vercel cron, every minute.

export const maxDuration = 300

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const followUps = await releaseDueFollowUps(mailDb())
  const [sent, cards] = await Promise.all([sendDueEmails(), drainCardQueue({ budgetMs: 200_000 })])
  return NextResponse.json({ ...sent, followUps, cards: cards.made })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return GET(req)
}
