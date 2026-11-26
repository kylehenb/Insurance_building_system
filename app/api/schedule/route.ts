import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { SCHEDULE_KINDS, loadSchedule, type ScheduleKind } from '@/lib/schedule/schedule'

// GET ?from=2026-12-01&to=2026-12-07&kinds=inspection,repair&person=me|everyone|<user id>&trade=painter
// The Calendar page's schedule (tech spec §23.18) — the same loadSchedule as
// get_schedule by voice. Read only. Also returns the office's people for the
// person filter.
const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()

  const q = req.nextUrl.searchParams
  const from = q.get('from') ?? ''
  const to = q.get('to') ?? from
  if (!DATE.test(from) || !DATE.test(to) || to < from) return NextResponse.json({ error: 'from and to should be dates, from first' }, { status: 400 })
  const kinds = (q.get('kinds') ?? '').split(',').filter((k): k is ScheduleKind => SCHEDULE_KINDS.includes(k as ScheduleKind))
  const person = q.get('person') ?? 'everyone'
  const personId = person === 'everyone' ? undefined : person === 'me' ? me.userId : person

  const db = createServiceClient() as unknown as SupabaseClient
  try {
    const [entries, { data: users }] = await Promise.all([
      loadSchedule(db, me.tenantId, {
        from, to, kinds: kinds.length ? kinds : undefined, personId,
        includeUnassigned: personId === me.userId, trade: q.get('trade') || undefined,
      }),
      db.from('users').select('id, name').eq('tenant_id', me.tenantId).order('name'),
    ])
    return NextResponse.json({ entries, people: users ?? [], me: me.userId })
  } catch (err) {
    console.error('[schedule] failed:', err)
    return NextResponse.json({ error: 'Couldn\'t load the schedule' }, { status: 500 })
  }
}
