import { NextRequest, NextResponse } from 'next/server'
import { sendDueEmails } from '@/lib/mail/scheduled'

// Sends scheduled emails that are due (lib/mail/scheduled.ts). Vercel cron, every minute.

export const maxDuration = 120

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await sendDueEmails())
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return GET(req)
}
