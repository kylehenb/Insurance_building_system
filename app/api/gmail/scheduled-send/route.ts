import { NextRequest, NextResponse } from 'next/server'
import { sendDueEmails } from '@/lib/mail/scheduled'
import { drainCardQueue } from '@/lib/actions/propose'
import { releaseDueFollowUps } from '@/lib/actions/followups'
import { drainSentQueue } from '@/lib/actions/waiting-on'
import { applyChangedKpis } from '@/lib/kpi/client-kpis'
import { mailDb } from '@/lib/mail/sync'
import { withCronRun } from '@/lib/health/cron'

// Sends scheduled emails that are due (lib/mail/scheduled.ts), puts
// follow-ups that are due on the list (lib/actions/followups.ts), makes
// queued action cards (lib/actions/propose.ts) and reads the office's sent
// emails for what they're waiting on (lib/actions/waiting-on.ts), and
// carries an insurer's changed KPIs onto its jobs (lib/kpi/client-kpis.ts).
// Vercel cron, every minute.

export const maxDuration = 300

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

async function runGet(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const followUps = await releaseDueFollowUps(mailDb())
  const kpiJobs = await applyChangedKpis(mailDb()).catch(err => { console.error('[kpi] applying changed KPIs failed:', err); return 0 })
  const [sent, cards, waits] = await Promise.all([sendDueEmails(), drainCardQueue({ budgetMs: 200_000 }), drainSentQueue({ budgetMs: 120_000 })])
  return NextResponse.json({ ...sent, followUps, cards: cards.made, sentRead: waits.read, kpiJobs })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return GET(req)
}

// Each run is recorded for the health watcher (tech spec §25)
export const GET = withCronRun('/api/gmail/scheduled-send', runGet)
