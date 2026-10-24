import { NextRequest, NextResponse } from 'next/server'
import { getMailbox, mailDb, syncMailbox } from '@/lib/mail/sync'
import { onMailArrivals } from '@/lib/actions/cards'

// Backstop for the mail client's mirror of the office mailbox (lib/mail/sync.ts).
// The Gmail push webhook normally syncs within seconds; this catches anything
// it missed and works through the first backfill a chunk at a time.
// Vercel cron, every 2 minutes.

export const maxDuration = 300

const WATCHED_EMAIL = 'office@insurancerepairco.com.au'

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

async function run(): Promise<NextResponse> {
  const db = mailDb()
  const { data: syncState } = await db
    .from('gmail_sync_state')
    .select('tenant_id')
    .eq('email_address', WATCHED_EMAIL)
    .limit(1)
    .single()
  if (!syncState) {
    return NextResponse.json({ error: 'No sync state found — run /api/gmail/setup first' }, { status: 404 })
  }

  const mailbox = await getMailbox((syncState as { tenant_id: string }).tenant_id, db)
  const result = await syncMailbox(mailbox, { budgetMs: 240_000 }, db)
  // Anything the webhook missed gets its action card (made by the scheduled-send cron)
  await onMailArrivals(db, mailbox.tenant_id, result.arrivals)
  return NextResponse.json(result, { status: result.error ? 502 : 200 })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return run()
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return run()
}
