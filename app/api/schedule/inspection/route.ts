import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'
import { createServiceClient } from '@/lib/supabase/server'
import { recordActivity } from '@/lib/activity/log'
import { InspectionBookingError, bookInspection } from '@/lib/inspections/booking'
import { addJobNote } from '@/lib/communications/notes'
import { parseSendAt, spokenSendAt } from '@/lib/mail/schedule-rules'

// POST { job_id, start: "2026-12-03T08:00" (Perth), minutes?, note?, inspection_id? }
// Book or move an inspection from the Calendar page (tech spec §23.18) —
// bookInspection, the same as book_inspection by voice: confirmed in IRC and
// one event in the owner's calendar with directions and the field app link.
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

export async function POST(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const jobId = str(body?.job_id)
  const start = parseSendAt(str(body?.start) ?? '')
  if (!jobId || !start) return NextResponse.json({ error: 'A job and a start date and time are required' }, { status: 400 })
  const minutes = Math.min(720, Math.max(5, Math.round(Number(body?.minutes) || 60)))

  const denied = await permissionDenied(me.tenantId, me.userId, 'jobs.edit')
  if (denied) return denied

  const service = createServiceClient()
  try {
    const note = str(body?.note)
    const booking = await bookInspection(service as unknown as SupabaseClient, {
      tenantId: me.tenantId, jobId, start, minutes, inspectionId: str(body?.inspection_id), bookingNote: note,
    })
    if (note) {
      await addJobNote(service, { tenantId: me.tenantId, userId: me.userId, jobId, note: `Inspection booked for ${spokenSendAt(start)}. ${note}`, source: 'app' })
        .catch(err => console.error('[schedule/inspection] note not added:', err))
    }
    await recordActivity({
      tenantId: me.tenantId, userId: me.userId, action: 'jobs.edit', jobId, via: 'app', service,
      summary: `${booking.moved ? 'Moved' : 'Booked'} the inspection on ${booking.job_number} for ${spokenSendAt(start)}`, detail: note ?? null,
    })
    return NextResponse.json(booking)
  } catch (err) {
    if (err instanceof InspectionBookingError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[schedule/inspection] failed:', err)
    return NextResponse.json({ error: 'Couldn\'t book the inspection' }, { status: 500 })
  }
}
