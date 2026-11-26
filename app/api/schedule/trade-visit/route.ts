import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'
import { createServiceClient } from '@/lib/supabase/server'
import { recordActivity } from '@/lib/activity/log'
import { VisitScheduleError, scheduleTradeVisit } from '@/lib/work-orders/visits'
import { dayLabel } from '@/lib/schedule/schedule'

// POST { work_order_id, start_date?, end_date?, start_time?, all_day?, visit_number?, note?, clear? }
// Book, move or take off a trade's day(s) on site from the Calendar page
// (tech spec §23.18) — scheduleTradeVisit, the same as book_trade_visit by voice.
// jobs.edit has no approval level, so it's allowed or refused.
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

export async function POST(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const workOrderId = str(body?.work_order_id)
  if (!workOrderId) return NextResponse.json({ error: 'work_order_id is required' }, { status: 400 })

  const denied = await permissionDenied(me.tenantId, me.userId, 'jobs.edit')
  if (denied) return denied

  const service = createServiceClient()
  const db = service as unknown as SupabaseClient
  const { data: wo } = await db.from('work_orders').select('job_id, trade_name, jobs!job_id(job_number)').eq('tenant_id', me.tenantId).eq('id', workOrderId).maybeSingle()
  const workOrder = wo as unknown as { job_id: string; trade_name: string | null; jobs: { job_number: string } | null } | null
  if (!workOrder) return NextResponse.json({ error: 'Work order not found' }, { status: 404 })

  try {
    const v = await scheduleTradeVisit(db, {
      tenantId: me.tenantId, workOrderId,
      startDate: str(body?.start_date), endDate: str(body?.end_date), startTime: str(body?.start_time),
      allDay: body?.all_day === true, visitNumber: Number(body?.visit_number) || undefined, note: str(body?.note), clear: body?.clear === true,
    })
    const trade = workOrder.trade_name ?? 'trade'
    const job = workOrder.jobs?.job_number ?? 'the job'
    const days = v.start_date ? `${dayLabel(v.start_date)}${v.end_date ? ` to ${dayLabel(v.end_date)}` : ''}${v.start_time ? ` at ${v.start_time}` : ''}` : ''
    const summary = body?.clear === true ? `Took the ${trade} off the schedule on ${job}` : `${v.previous ? 'Moved' : 'Booked'} the ${trade} on ${job} for ${days}`
    await recordActivity({ tenantId: me.tenantId, userId: me.userId, action: 'jobs.edit', jobId: workOrder.job_id, via: 'app', service, summary, detail: str(body?.note) ?? null })
    return NextResponse.json(v)
  } catch (err) {
    if (err instanceof VisitScheduleError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[schedule/trade-visit] failed:', err)
    return NextResponse.json({ error: 'Couldn\'t save the booking' }, { status: 500 })
  }
}
