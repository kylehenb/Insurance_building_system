import { NextRequest, NextResponse } from 'next/server'
import { getCalendarClient } from '@/lib/calendar/client'
import { syncCalendars } from '@/lib/calendar/sync'
import { mailDb } from '@/lib/mail/sync'
import { withCronRun } from '@/lib/health/cron'

// Copies the watched calendars into calendar_events and links new or changed
// events to their jobs (lib/calendar/sync.ts, tech spec §23.13). Vercel cron,
// every 5 minutes.

export const maxDuration = 120

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

async function runGet(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await syncCalendars(mailDb(), getCalendarClient)
  return NextResponse.json(result, { status: result.errors.length ? 207 : 200 })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return GET(req)
}

// Each run is recorded for the health watcher (tech spec §25)
export const GET = withCronRun('/api/calendar/sync', runGet)
