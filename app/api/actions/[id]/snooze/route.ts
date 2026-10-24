import { NextRequest, NextResponse } from 'next/server'
import { cardAccess, isUuid } from '@/lib/actions/access'
import { snoozeCard } from '@/lib/actions/cards'
import { parseSendAt } from '@/lib/mail/schedule-rules'
import { mailDb } from '@/lib/mail/sync'

type Params = { params: Promise<{ id: string }> }

// POST /api/actions/[id]/snooze { until } — back in Action cards then (Perth time or ISO)
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid card' }, { status: 400 })
  let body: { until?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const until = typeof body.until === 'string' ? parseSendAt(body.until) : null
  if (!until || new Date(until).getTime() < Date.now()) return NextResponse.json({ error: 'until must be a time in the future' }, { status: 400 })
  const ok = await snoozeCard(mailDb(), access.tenantId, id, until)
  return ok ? NextResponse.json({ ok: true, until }) : NextResponse.json({ error: 'This card can\'t be snoozed now' }, { status: 409 })
}
